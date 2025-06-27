import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';

const prisma = new PrismaClient();

// Função para enviar notificação diária
async function sendDailyReminder() {
    try {
        // Buscar todos os dispositivos
        const devices = await prisma.deviceToken.findMany();
        
        if (devices.length === 0) {
            console.log('Nenhum dispositivo registrado para notificação diária');
            return;
        }

        console.log(`🔔 Enviando notificação diária...`);
        console.log(`📱 Dispositivos encontrados: ${devices.length}`);

        // Separar tokens por tipo
        const firebaseTokens = [];
        const expoTokens = [];
        
        devices.forEach(device => {
            if (device.deviceToken.includes('Expo') || device.deviceToken.includes('expo')) {
                expoTokens.push(device.deviceToken);
            } else {
                firebaseTokens.push(device.deviceToken);
            }
        });

        // Preparar a mensagem
        const message = {
            notification: {
                title: "Attention",
                body: "Complete your protocol today to get closer to your ultimate goal!"
            },
            data: {
                messageType: 'daily_reminder',
                timestamp: new Date().toISOString()
            }
        };

        // Enviar para dispositivos Firebase
        if (firebaseTokens.length > 0) {
            const sendPromises = firebaseTokens.map(async (token) => {
                try {
                    const tokenMessage = {
                        ...message,
                        token: token
                    };
                    const response = await admin.messaging().send(tokenMessage);
                    console.log('✅ Notificação diária enviada com sucesso para:', token);
                    return { success: true, token };
                } catch (error) {
                    console.error(`❌ Erro ao enviar notificação diária para ${token}:`, error.code);
                    return { success: false, token, error: error.code };
                }
            });

            const results = await Promise.all(sendPromises);
            console.log('\n📊 Resumo do envio diário:');
            console.log(`✅ Enviadas com sucesso: ${results.filter(r => r.success).length}`);
            console.log(`❌ Falhas: ${results.filter(r => !r.success).length}\n`);
        }

        // Enviar para dispositivos Expo
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
                        title: "Attention",
                        body: "Complete your protocol today to get closer to your ultimate goal!",
                        sound: 'default',
                        badge: 1,
                        data: {
                            messageType: 'daily_reminder',
                            timestamp: new Date().toISOString()
                        }
                    })))
                });
                
                const result = await response.json();
                console.log('Resultado do envio Expo:', JSON.stringify(result, null, 2));
            } catch (error) {
                console.error('Erro ao enviar via Expo:', error);
            }
        }

    } catch (error) {
        console.error('❌ Erro ao enviar notificação diária:', error);
    }
}

// Agendar a notificação diária para as 16:00 (São Paulo)
const dailyScheduleSP = cron.schedule('0 16 * * *', async () => {
    console.log('🕒 Iniciando envio de notificação diária agendada (São Paulo)...');
    await sendDailyReminder();
}, {
    timezone: "America/Sao_Paulo"
});

// Agendar notificações a cada 2 horas durante horário comercial UK (9:00 - 17:00)
const ukNotifications = [
    cron.schedule('0 9 * * *', async () => {
        console.log('🕒 Enviando notificação - 9:00 UK');
        await sendDailyReminder();
    }, { timezone: "Europe/London" }),
    
    cron.schedule('0 11 * * *', async () => {
        console.log('🕒 Enviando notificação - 11:00 UK');
        await sendDailyReminder();
    }, { timezone: "Europe/London" }),
    
    cron.schedule('0 13 * * *', async () => {
        console.log('🕒 Enviando notificação - 13:00 UK');
        await sendDailyReminder();
    }, { timezone: "Europe/London" }),
    
    cron.schedule('0 15 * * *', async () => {
        console.log('🕒 Enviando notificação - 15:00 UK');
        await sendDailyReminder();
    }, { timezone: "Europe/London" }),
    
    cron.schedule('0 17 * * *', async () => {
        console.log('🕒 Enviando notificação - 17:00 UK');
        await sendDailyReminder();
    }, { timezone: "Europe/London" })
];

export function startScheduledNotifications() {
    console.log('✅ Serviço de notificações agendadas iniciado');
    console.log('📅 Notificações agendadas:');
    console.log('- 16:00 (São Paulo)');
    console.log('- A cada 2 horas entre 9:00 e 17:00 (UK)');
    
    dailyScheduleSP.start();
    ukNotifications.forEach(schedule => schedule.start());
}

export function stopScheduledNotifications() {
    console.log('⛔ Serviço de notificações agendadas parado');
    dailyScheduleSP.stop();
    ukNotifications.forEach(schedule => schedule.stop());
} 