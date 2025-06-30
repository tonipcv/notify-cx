import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';

const prisma = new PrismaClient();

// Function to fetch user's protocol information
async function getUserProtocolInfo(userId) {
    try {
        const response = await fetch(`https://app.cxlus.com/api/protocols/available`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        const data = await response.json();
        return data;
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
        const startDate = new Date(nextProtocol.assignments[0].startDate);
        const daysUntilStart = Math.ceil((startDate - new Date()) / (1000 * 60 * 60 * 24));
        
        return {
            title: "Treatment Starting Soon! 🎯",
            body: `Your treatment plan begins in ${daysUntilStart} days. Get ready for your transformation journey!`,
            type: 'starting_soon'
        };
    }

    // Check if the active protocol is completed
    const activeProtocol = userProtocols.active[0];
    if (activeProtocol.progress === 100) {
        return {
            title: "Treatment Complete! 🎉",
            body: "Congratulations on completing your treatment! Schedule a follow-up with your doctor.",
            type: 'completed'
        };
    }

    return null;
}

// Morning notification (8:00 AM)
const morningReminder = cron.schedule('0 8 * * *', async () => {
    console.log('🌅 Starting morning notification...');
    
    try {
        const devices = await prisma.deviceToken.findMany();
        for (const device of devices) {
            const userProtocols = await getUserProtocolInfo(device.userId);
            
            // Check special status first
            const statusMessage = await getProtocolStatusMessage(userProtocols, device);
            if (statusMessage) {
                await sendPersonalizedNotification(
                    statusMessage.title,
                    statusMessage.body,
                    device.userId,
                    statusMessage.type
                );
                continue; // Skip regular notification
            }

            // Regular notification for active treatment
            if (userProtocols?.active?.length > 0) {
                const protocol = userProtocols.active[0];
                const tasks = protocol.days[protocol.currentDay - 1]?.sessions[0]?.tasks || [];
                const totalTasks = tasks.length;
                
                await sendPersonalizedNotification(
                    `Good Morning, ${device.name || 'Patient'}! 🌞`,
                    `You have ${totalTasks} tasks scheduled for today. Open the app to start your treatment journey!`,
                    device.userId,
                    'morning_tasks'
                );
            }
        }
    } catch (error) {
        console.error('Error in morning notification:', error);
    }
}, {
    timezone: "America/Sao_Paulo"
});

// Afternoon notification (2:00 PM) - Incomplete checklist
const afternoonReminder = cron.schedule('0 14 * * *', async () => {
    console.log('🌇 Starting afternoon check...');
    
    try {
        const devices = await prisma.deviceToken.findMany();
        for (const device of devices) {
            const userProtocols = await getUserProtocolInfo(device.userId);
            
            // Check special status first
            const statusMessage = await getProtocolStatusMessage(userProtocols, device);
            if (statusMessage) {
                // Don't send afternoon reminder for non-active treatments
                continue;
            }

            // Regular notification for active treatment
            if (userProtocols?.active?.length > 0) {
                const protocol = userProtocols.active[0];
                const incompleteTasks = protocol.days[protocol.currentDay - 1]?.sessions[0]?.tasks.filter(task => !task.isCompleted) || [];
                
                if (incompleteTasks.length > 0) {
                    await sendPersonalizedNotification(
                        `Treatment Reminder ⏰`,
                        `You have ${incompleteTasks.length} pending tasks remaining. Keep up with your treatment plan!`,
                        device.userId,
                        'afternoon_reminder'
                    );
                }
            }
        }
    } catch (error) {
        console.error('Error in afternoon notification:', error);
    }
}, {
    timezone: "America/Sao_Paulo"
});

// Evening notification (8:00 PM)
const eveningReminder = cron.schedule('0 20 * * *', async () => {
    console.log('🌙 Starting evening notification...');
    
    try {
        const devices = await prisma.deviceToken.findMany();
        for (const device of devices) {
            const userProtocols = await getUserProtocolInfo(device.userId);
            
            // Check special status first
            const statusMessage = await getProtocolStatusMessage(userProtocols, device);
            if (statusMessage) {
                // Only send evening status message for completed treatments
                if (statusMessage.type === 'completed') {
                    await sendPersonalizedNotification(
                        statusMessage.title,
                        statusMessage.body,
                        device.userId,
                        statusMessage.type
                    );
                }
                continue;
            }

            // Regular notification for active treatment
            if (userProtocols?.active?.length > 0) {
                const protocol = userProtocols.active[0];
                const completedTasks = protocol.days[protocol.currentDay - 1]?.sessions[0]?.tasks.filter(task => task.isCompleted).length || 0;
                const totalTasks = protocol.days[protocol.currentDay - 1]?.sessions[0]?.tasks.length || 0;
                
                let message = `Today's Progress: ${completedTasks}/${totalTasks} tasks completed.\n\n`;
                if (completedTasks === totalTasks) {
                    message += "Excellent work today! 🎉\nRest well and see you tomorrow!";
                } else {
                    message += "Take a moment to review your remaining tasks.\nEvery step matters in your treatment journey! 💪";
                }
                
                await sendPersonalizedNotification(
                    `Daily Summary 📋`,
                    message,
                    device.userId,
                    'evening_summary'
                );
            }
        }
    } catch (error) {
        console.error('Error in evening notification:', error);
    }
}, {
    timezone: "America/Sao_Paulo"
});

export function startScheduledNotifications() {
    console.log('✅ Scheduled notification service started');
    console.log('📅 Scheduled notifications:');
    console.log('- 08:00 AM - Morning task reminder');
    console.log('- 02:00 PM - Pending tasks check');
    console.log('- 08:00 PM - Daily progress summary');
    
    morningReminder.start();
    afternoonReminder.start();
    eveningReminder.start();
}

export function stopScheduledNotifications() {
    console.log('⛔ Scheduled notification service stopped');
    morningReminder.stop();
    afternoonReminder.stop();
    eveningReminder.stop();
} 