import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';

const prisma = new PrismaClient();

// Function to fetch user's protocol information
async function getUserProtocolInfo(userId) {
    try {
        const response = await fetch(`https://app.cxlus.com/api/protocols/assignments`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        const data = await response.json();
        
        // Get daily check-in data for active protocols
        const activeProtocols = data.filter(p => p.status === 'ACTIVE');
        const protocolsWithCheckin = await Promise.all(activeProtocols.map(async (protocol) => {
            try {
                const checkinResponse = await fetch(`https://app.cxlus.com/api/mobile/daily-checkin?protocolId=${protocol.id}`, {
                    headers: {
                        'Authorization': `Bearer ${process.env.API_TOKEN}`
                    }
                });
                const checkinData = await checkinResponse.json();
                return {
                    ...protocol,
                    hasCheckinToday: checkinData.hasCheckinToday,
                    checkinQuestions: checkinData.questions,
                    checkinResponses: checkinData.existingResponses
                };
            } catch (error) {
                console.error(`Error fetching check-in data for protocol ${protocol.id}:`, error);
                return protocol;
            }
        }));

        return {
            active: protocolsWithCheckin,
            to_start: data.filter(p => p.status === 'INACTIVE')
        };
    } catch (error) {
        console.error('Error fetching protocol information:', error);
        return null;
    }
}

// Function to send personalized notification
async function sendPersonalizedNotification(title, body, userId = null, messageType = 'daily_reminder') {
    try {
        // Fetch devices (filter by userId if provided)
        const whereClause = userId ? { userId } : {};
        const devices = await prisma.deviceToken.findMany({ where: whereClause });
        
        if (devices.length === 0) {
            console.log('No devices registered for notification');
            return;
        }

        console.log(`🔔 Sending personalized notification...`);
        console.log(`📱 Devices found: ${devices.length}`);

        // Separate tokens by type
        const firebaseTokens = [];
        const expoTokens = [];
        
        devices.forEach(device => {
            if (device.deviceToken.includes('Expo') || device.deviceToken.includes('expo')) {
                expoTokens.push(device.deviceToken);
            } else {
                firebaseTokens.push(device.deviceToken);
            }
        });

        // Send to Firebase devices
        if (firebaseTokens.length > 0) {
            const sendPromises = firebaseTokens.map(async (token) => {
                try {
                    const message = {
                        notification: {
                            title,
                            body
                        },
                        data: {
                            messageType,
                            timestamp: new Date().toISOString()
                        },
                        token
                    };
                    
                    const response = await admin.messaging().send(message);
                    console.log('✅ Notification sent successfully to:', token);
                    return { success: true, token };
                } catch (error) {
                    console.error(`❌ Error sending notification to ${token}:`, error.code);
                    return { success: false, token, error: error.code };
                }
            });

            const results = await Promise.all(sendPromises);
            console.log('\n📊 Sending summary:');
            console.log(`✅ Successfully sent: ${results.filter(r => r.success).length}`);
            console.log(`❌ Failed: ${results.filter(r => !r.success).length}\n`);
        }

        // Send to Expo devices
        if (expoTokens.length > 0) {
            try {
                const response = await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip, deflate',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(expoTokens.map(token => ({
                        to: token,
                        title,
                        body,
                        sound: 'default',
                        badge: 1,
                        data: {
                            messageType,
                            timestamp: new Date().toISOString()
                        }
                    })))
                });
                
                const result = await response.json();
                console.log('Expo sending result:', JSON.stringify(result, null, 2));
            } catch (error) {
                console.error('Error sending via Expo:', error);
            }
        }
    } catch (error) {
        console.error('❌ Error sending notification:', error);
    }
}

// Function to check protocol status and get appropriate message
async function getProtocolStatusMessage(userProtocols, device) {
    if (!userProtocols || (!userProtocols.active?.length && !userProtocols.to_start?.length)) {
        return {
            title: "Welcome to Cxlus! 👋",
            body: "No active treatment yet. Contact your doctor to start your journey!",
            type: 'no_treatment'
        };
    }

    // Check for protocols that haven't started yet
    if (userProtocols.to_start?.length > 0) {
        const nextProtocol = userProtocols.to_start[0];
        const startDate = new Date(nextProtocol.startDate);
        const daysUntilStart = Math.ceil((startDate - new Date()) / (1000 * 60 * 60 * 24));
        
        return {
            title: "Treatment Starting Soon! 🎯",
            body: `Your treatment plan begins in ${daysUntilStart} days. Get ready for your transformation journey!`,
            type: 'starting_soon'
        };
    }

    // Check if the active protocol is completed
    const activeProtocol = userProtocols.active[0];
    if (activeProtocol.progress >= 100) {
        return {
            title: "Treatment Complete! 🎉",
            body: "Congratulations on completing your treatment! Schedule a follow-up with your doctor.",
            type: 'completed'
        };
    }

    // Check if daily check-in is completed
    if (activeProtocol.hasCheckinToday) {
        return {
            title: "Daily Check-in Complete! ✅",
            body: "Great job on completing your daily check-in! Keep up the good work!",
            type: 'checkin_complete'
        };
    }

    return null;
}

// Store for tracking sent notifications with persistence
const notificationTracker = new Map();

// Function to check if notification was already sent today
async function wasNotificationSentToday(userId, type) {
    const key = `${userId}_${type}_${new Date().toDateString()}`;
    
    // Check in-memory cache first
    if (notificationTracker.get(key)) {
        return true;
    }

    // Check database
    try {
        const sent = await prisma.notificationLog.findFirst({
            where: {
                userId: userId,
                type: type,
                createdAt: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0)) // Start of today
                }
            }
        });
        return !!sent;
    } catch (error) {
        console.error('Error checking notification log:', error);
        return false;
    }
}

// Function to mark notification as sent
async function markNotificationAsSent(userId, type) {
    const key = `${userId}_${type}_${new Date().toDateString()}`;
    notificationTracker.set(key, true);
    
    // Store in database
    try {
        await prisma.notificationLog.create({
            data: {
                userId: userId,
                type: type,
                createdAt: new Date()
            }
        });
    } catch (error) {
        console.error('Error logging notification:', error);
    }
    
    // Clear old entries from memory (older than 2 days)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    for (const [key] of notificationTracker) {
        const [, , dateStr] = key.split('_');
        if (new Date(dateStr) < twoDaysAgo) {
            notificationTracker.delete(key);
        }
    }

    // Clear old entries from database (older than 7 days)
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        await prisma.notificationLog.deleteMany({
            where: {
                createdAt: {
                    lt: sevenDaysAgo
                }
            }
        });
    } catch (error) {
        console.error('Error cleaning old notification logs:', error);
    }
}

// Function to initialize notification tracker from database
async function initializeNotificationTracker() {
    try {
        // Get today's notifications
        const today = new Date(new Date().setHours(0, 0, 0, 0));
        const notifications = await prisma.notificationLog.findMany({
            where: {
                createdAt: {
                    gte: today
                }
            }
        });

        // Load into memory
        notifications.forEach(notification => {
            const key = `${notification.userId}_${notification.type}_${notification.createdAt.toDateString()}`;
            notificationTracker.set(key, true);
        });

        console.log(`✅ Loaded ${notifications.length} notifications into tracker`);
    } catch (error) {
        console.error('Error initializing notification tracker:', error);
    }
}

// Hourly check-in reminder (8 AM to 8 PM)
const hourlyReminder = cron.schedule('0 8-20 * * *', async () => {
    const currentHour = new Date().getHours();
    console.log(`🕐 Starting ${currentHour}:00 notification check...`);
    
    try {
        const devices = await prisma.deviceToken.findMany();
        for (const device of devices) {
            // Check if notification was already sent this hour
            if (wasNotificationSentToday(device.userId, `hour_${currentHour}`)) {
                console.log(`${currentHour}:00 notification already sent to user ${device.userId}`);
                continue;
            }

            const userProtocols = await getUserProtocolInfo(device.userId);
            
            // Skip if no active protocols or if check-in is already done
            if (!userProtocols?.active?.length || userProtocols.active[0].hasCheckinToday) {
                continue;
            }

            // Skip during main notification hours (8, 14, and 20)
            if (currentHour === 8 || currentHour === 14 || currentHour === 20) {
                continue;
            }

            let message;
            // Morning message (9-11)
            if (currentHour >= 9 && currentHour <= 11) {
                message = `Good morning! Don't forget to start your daily check-in. It only takes a few minutes! 🌅`;
            }
            // Afternoon message (12-16)
            else if (currentHour >= 12 && currentHour <= 16) {
                message = `How's your day going? Take a moment to complete your daily check-in! ☀️`;
            }
            // Evening message (17-19)
            else {
                message = `The day is almost over. Don't forget to complete your daily check-in! 🌙`;
            }

            await sendPersonalizedNotification(
                `Check-in Reminder ⏰`,
                message,
                device.userId,
                'hourly_reminder'
            );
            markNotificationAsSent(device.userId, `hour_${currentHour}`);
        }
    } catch (error) {
        console.error(`Error in ${currentHour}:00 notification:`, error);
    }
}, {
    timezone: "Europe/London"
});

export function startScheduledNotifications() {
    console.log('✅ Scheduled notification service started');
    console.log('📅 Scheduled notifications (UK Time):');
    console.log('- 08:00 AM - Morning check-in reminder');
    console.log('- 02:00 PM - Pending check-in reminder');
    console.log('- 08:00 PM - Daily progress summary');
    console.log('+ Hourly check-in reminders between main notifications');
    
    // Initialize notification tracker
    initializeNotificationTracker().then(() => {
        morningReminder.start();
        afternoonReminder.start();
        eveningReminder.start();
        hourlyReminder.start();
    });
}

export function stopScheduledNotifications() {
    console.log('⛔ Scheduled notification service stopped');
    morningReminder.stop();
    afternoonReminder.stop();
    eveningReminder.stop();
    hourlyReminder.stop();
} 