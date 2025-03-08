import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log('\n=== Nova Requisição ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Método:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('=====================\n');
  next();
});

const DEBUG = true;

// Verificar se o arquivo de configuração do Firebase existe
const firebaseConfigPath = process.env.NODE_ENV === 'production' 
  ? '/firebase-service-account.json'
  : path.join(__dirname, 'firebase-service-account.json');

// Inicializar o Firebase Admin SDK
try {
  // Se o arquivo de configuração existir, use-o
  if (fs.existsSync(firebaseConfigPath)) {
    console.log(`✅ Arquivo de configuração do Firebase encontrado em: ${firebaseConfigPath}`);
    const serviceAccount = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    // Caso contrário, tente usar variáveis de ambiente
    console.log('⚠️ Arquivo de configuração do Firebase não encontrado, tentando usar variáveis de ambiente...');
    
    // Verificar se as variáveis de ambiente necessárias estão definidas
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.error('❌ Variáveis de ambiente do Firebase não configuradas corretamente');
      console.error('Por favor, configure FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY e FIREBASE_CLIENT_EMAIL');
      process.exit(1);
    }
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
  }
  
  console.log('✅ Firebase Admin SDK inicializado com sucesso');
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase Admin SDK:', error);
  process.exit(1);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    webhook_url: process.env.WEBHOOK_URL,
    server: 'running',
    database: 'connected'
  });
});

// 1. Rota principal para teste
app.get('/', (req, res) => {
  res.send('Servidor rodando. Webhook em /telegram-webhook');
});

// 2. Rota para registrar dispositivos
app.post('/register-device', async (req, res) => {
  console.log('\n=== INÍCIO DO REGISTRO DE DISPOSITIVO ===');
  console.log('Headers recebidos:', req.headers);
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  
  // Extrair dados do body
  const { deviceToken, userId, platform } = req.body;
  
  // Verificar token
  if (!deviceToken) {
    console.log('❌ Erro: Device token não fornecido');
    return res.status(400).json({ 
      error: 'Device token é obrigatório',
      receivedPayload: req.body 
    });
  }

  try {
    // Log detalhado dos dados recebidos
    console.log(`📱 Registrando dispositivo:
      Token: ${deviceToken}
      Usuário: ${userId || 'anônimo'}
      Plataforma: ${platform || 'ios'}`);

    // Armazena o token no banco de dados
    const result = await prisma.deviceToken.upsert({
      where: { 
        deviceToken: deviceToken 
      },
      update: {
        userId: userId || 'anônimo',
        platform: platform || 'ios',
        lastUpdated: new Date()
      },
      create: {
        deviceToken: deviceToken,
        userId: userId || 'anônimo',
        platform: platform || 'ios'
      }
    });
    
    console.log('✅ Dispositivo registrado com sucesso:', result);
    res.json({ 
      success: true, 
      message: 'Dispositivo registrado com sucesso', 
      data: result 
    });

  } catch (error) {
    console.error('❌ Erro ao registrar dispositivo:', error);
    res.status(500).json({ 
      error: 'Erro ao registrar dispositivo',
      details: error.message
    });
  }
});

// 3. Rota Webhook do Telegram
app.post('/telegram-webhook', async (req, res) => {
  // Enviar resposta imediatamente para o Telegram
  res.sendStatus(200);
  
  console.log('\n Telegram Webhook Acionado');
  console.log('Timestamp:', new Date().toISOString());
  console.log('URL completa:', req.protocol + '://' + req.get('host') + req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Body completo:', req.body);
  console.log('Query:', req.query);
  console.log('Method:', req.method);
  console.log('IP:', req.ip);
  
  try {
    const update = req.body;
    console.log('Update recebido do Telegram:', JSON.stringify(update, null, 2));

    if (update.message && update.message.text) {
      const messageText = update.message.text;
      const from = update.message.from;
      console.log(`📩 Mensagem: "${messageText}"`);
      console.log(`👤 De: ${from.first_name} (ID: ${from.id})`);

      console.log('🔔 Enviando notificação via Firebase...');
      // Enviar para todos os dispositivos registrados
      await sendFirebaseNotification(messageText, from.first_name);
      console.log('✅ Notificação enviada com sucesso');
    } else {
      console.log('⚠️ Recebido update que não é mensagem de texto:', JSON.stringify(update, null, 2));
    }

    // Log da resposta
    console.log('✅ Enviando resposta 200 para o Telegram');
  } catch (error) {
    console.error('❌ Erro no processamento do webhook:', error);
    console.error('Stack trace:', error.stack);
    console.error('Request body:', req.body);
  }
});

// 4. Rota para configurar webhook do Telegram
app.get('/setup-webhook', async (req, res) => {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  
  console.log('Configurando webhook com:');
  console.log('Token:', TELEGRAM_BOT_TOKEN);
  console.log('URL:', WEBHOOK_URL);
  
  try {
    // Verificar status atual
    const statusResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    );
    const statusData = await statusResponse.json();
    console.log('Status atual detalhado do webhook:', JSON.stringify(statusData, null, 2));

    // Configurar novo webhook
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          allowed_updates: ["message", "edited_message", "callback_query"]
        })
      }
    );
    const data = await response.json();
    console.log('Resposta da configuração do webhook:', JSON.stringify(data, null, 2));
    
    res.json({
      status: 'Verificação completa',
      webhookInfo: statusData,
      setupResponse: data
    });
  } catch (error) {
    console.error('Erro ao configurar webhook:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Erro ao configurar webhook',
      details: error.message,
      stack: error.stack
    });
  }
});

// 5. Função para enviar notificação via Firebase
async function sendFirebaseNotification(messageText, senderName) {
  try {
    // Buscar tokens no banco de dados
    const devices = await prisma.deviceToken.findMany();
    
    if (devices.length === 0) {
      console.log('Nenhum dispositivo registrado');
      return;
    }

    console.log(`🔔 Enviando notificação via Firebase...`);
    console.log(`📱 Dispositivos encontrados: ${devices.length}`);

    // Preparar a mensagem
    const message = {
      notification: {
        title: 'Futuros Tech',
        body: 'Novo sinal de entrada, caso seja Premium abra para ver!'
      },
      data: {
        sender: senderName,
        messageType: 'telegram',
        timestamp: new Date().toISOString()
      },
      android: {
        notification: {
          sound: 'default',
          channelId: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    // Enviar para cada dispositivo
    const sendPromises = devices.map(async (device) => {
      try {
        message.token = device.deviceToken;
        const response = await admin.messaging().send(message);
        console.log('✅ Notificação enviada com sucesso para:', device.deviceToken);
        console.log('Firebase response:', response);
        return { success: true, token: device.deviceToken };
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${device.deviceToken}:`, error.code);
        if (
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered'
        ) {
          console.log(`⚠️ Token inválido ou não registrado:`, device.deviceToken);
        }
        return { success: false, token: device.deviceToken, error: error.code };
      }
    });

    // Aguardar todas as notificações
    const results = await Promise.all(sendPromises);
    
    // Contabilizar resultados
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n📊 Resumo do envio:`);
    console.log(`✅ Enviadas com sucesso: ${successful}`);
    console.log(`❌ Falhas: ${failed}\n`);

    // Listar tokens com falha para referência
    const failedTokens = results.filter(r => !r.success);
    if (failedTokens.length > 0) {
      console.log('Tokens com falha:', failedTokens);
    }

  } catch (error) {
    console.error('❌ Erro ao enviar notificações:', error);
  }
}

// 6. Iniciar servidor
const PORT = process.env.PORT || 3000;

// Rota para testar envio de notificação
app.post('/send-test-notification', async (req, res) => {
  try {
    const { userId, message, title } = req.body;
    
    // Buscar tokens do dispositivo para o usuário
    const deviceTokens = await prisma.deviceToken.findMany({
      where: {
        userId: userId
      }
    });

    if (deviceTokens.length === 0) {
      return res.status(404).json({ error: 'Nenhum dispositivo encontrado para este usuário' });
    }

    // Separar tokens por tipo
    const iosTokens = [];
    const expoTokens = [];
    
    deviceTokens.forEach(device => {
      // Tokens do Expo geralmente começam com ExponentPushToken, ExpoPushToken ou ExpoMockPushToken
      if (device.deviceToken.includes('Expo') || 
          device.deviceToken.includes('expo')) {
        expoTokens.push(device.deviceToken);
      } else if (device.platform === 'ios') {
        iosTokens.push(device.deviceToken);
      }
    });
    
    console.log(`Dispositivos encontrados: ${deviceTokens.length}`);
    console.log(`Tokens iOS: ${iosTokens.length}`);
    console.log(`Tokens Expo: ${expoTokens.length}`);
    
    // Enviar para dispositivos iOS nativos via APNs
    if (iosTokens.length > 0) {
      const notification = new apn.Notification();
      notification.expiry = Math.floor(Date.now() / 1000) + 3600;
      notification.badge = 1;
      notification.sound = 'default';
      notification.alert = {
        title: title || 'Futuros Tech',
        body: message || 'Novo sinal de entrada, caso seja Premium abra para ver!'
      };
      notification.topic = process.env.BUNDLE_ID;
      
      notification.payload = {
        messageType: 'test',
        timestamp: new Date().toISOString()
      };
      
      console.log(`Enviando notificação de teste para ${iosTokens.length} dispositivos iOS via APNs`);
      const result = await apnProvider.send(notification, iosTokens);
      console.log('Resultado do envio de teste APNs:', JSON.stringify(result, null, 2));
    }
    
    // Enviar para dispositivos Expo
    if (expoTokens.length > 0) {
      console.log(`Enviando notificação de teste para ${expoTokens.length} dispositivos via Expo`);
      
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
            title: title || 'Futuros Tech',
            body: message || 'Novo sinal de entrada, caso seja Premium abra para ver!',
            sound: 'default',
            badge: 1,
            data: {
              messageType: 'test',
              timestamp: new Date().toISOString()
            }
          })))
        });
        
        const result = await response.json();
        console.log('Resultado do envio de teste Expo:', JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Erro ao enviar via Expo:', error);
      }
    }

    res.json({ 
      success: true, 
      message: 'Notificações enviadas com sucesso',
      deviceCount: deviceTokens.length,
      iosCount: iosTokens.length,
      expoCount: expoTokens.length
    });
  } catch (error) {
    console.error('Erro ao enviar notificações:', error);
    res.status(500).json({ error: 'Erro ao enviar notificações', details: error.message });
  }
});

// Rota para testar conexão com banco
app.get('/db-test', async (req, res) => {
  try {
    // Tenta contar os registros
    const count = await prisma.deviceToken.count();
    
    // Tenta buscar todos os registros
    const devices = await prisma.deviceToken.findMany();
    
    res.json({
      success: true,
      count,
      connection: 'OK',
      devices
    });
  } catch (error) {
    console.error('Erro ao testar banco:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      connection: 'FAILED'
    });
  }
});

// Rota para listar dispositivos registrados
app.get('/devices', async (req, res) => {
  try {
    const devices = await prisma.deviceToken.findMany();
    res.json({
      count: devices.length,
      devices: devices
    });
  } catch (error) {
    console.error('Erro ao listar dispositivos:', error);
    res.status(500).json({ error: 'Erro ao listar dispositivos' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'desenvolvimento'}`);
  console.log('\nRotas disponíveis:');
  console.log('- GET  /health');
  console.log('- GET  /');
  console.log('- POST /register-device');
  console.log('- POST /telegram-webhook');
  console.log('- POST /test-webhook');
  console.log('- GET  /setup-webhook');
  console.log('- GET  /devices');
  console.log('- GET  /db-test');
  console.log('- POST /send-test-notification\n');
});

// 7. Limpar recursos ao encerrar
process.on('SIGINT', async () => {
  console.log('Encerrando servidor e conexões...');
  await prisma.$disconnect();
  apnProvider.shutdown();
  process.exit();
});