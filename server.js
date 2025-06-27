import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import admin from 'firebase-admin';
import { startScheduledNotifications, stopScheduledNotifications } from './scheduled-notifications.js';

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

// Configurar CORS para o painel de notificações
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    server: 'running',
    database: 'connected'
  });
});

// Rota para receber notificações do painel
app.post('/send-notification', async (req, res) => {
  try {
    const { title, message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false,
        error: 'Mensagem é obrigatória',
        details: 'O campo message deve ser fornecido no corpo da requisição'
      });
    }

    console.log('🔔 Enviando notificação personalizada...');
    console.log(`📝 Título: ${title}`);
    console.log(`📝 Mensagem: ${message}`);

    await sendFirebaseNotification(message, 'Painel', title);

    // Buscar a contagem atual de dispositivos para incluir na resposta
    const deviceCount = await prisma.deviceToken.count();

    res.json({ 
      success: true, 
      message: 'Notificação enviada com sucesso',
      deviceCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erro ao enviar notificação:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao enviar notificação',
      details: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
});

// 1. Rota principal para teste
app.get('/', (req, res) => {
  res.send('Servidor de notificações iOS rodando');
});

// 2. Rota para registrar dispositivos
app.post('/register-device', async (req, res) => {
  console.log('\n=== INÍCIO DO REGISTRO DE DISPOSITIVO ===');
  console.log('Headers recebidos:', req.headers);
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  
  // Extrair dados do body
  const { deviceToken, userId, email, platform } = req.body;
  
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
      Email: ${email || 'não informado'}
      Plataforma: ${platform || 'ios'}`);

    // Armazena o token no banco de dados
    const result = await prisma.deviceToken.upsert({
      where: { 
        deviceToken: deviceToken 
      },
      update: {
        userId: userId || 'anônimo',
        email: email || null,
        platform: platform || 'ios',
        lastUpdated: new Date()
      },
      create: {
        deviceToken: deviceToken,
        userId: userId || 'anônimo',
        email: email || null,
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

// 5. Função para enviar notificação via Firebase
async function sendFirebaseNotification(messageText, senderName, customTitle = null, specificDevices = null) {
  try {
    // Usar dispositivos específicos se fornecidos, caso contrário buscar todos
    const devices = specificDevices || await prisma.deviceToken.findMany();
    
    if (devices.length === 0) {
      console.log('Nenhum dispositivo registrado');
      return;
    }

    console.log(`🔔 Enviando notificação via Firebase...`);
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

    console.log(`Tokens Firebase: ${firebaseTokens.length}`);
    console.log(`Tokens Expo: ${expoTokens.length}`);

    // Enviar para dispositivos Firebase
    if (firebaseTokens.length > 0) {
      // Preparar a mensagem Firebase
      const message = {
        notification: {
          title: customTitle || 'Futuros Tech',
          body: messageText
        },
        data: {
          sender: senderName,
          messageType: 'custom',
          message: messageText,
          timestamp: new Date().toISOString()
        }
      };

      // Enviar para cada dispositivo Firebase
      const sendPromises = firebaseTokens.map(async (token) => {
        try {
          const tokenMessage = {
            ...message,
            token: token // Adicionar token ao objeto da mensagem
          };
          const response = await admin.messaging().send(tokenMessage);
          console.log('✅ Notificação Firebase enviada com sucesso para:', token);
          console.log('Firebase response:', response);
          return { success: true, token };
        } catch (error) {
          console.error(`❌ Erro ao enviar para ${token}:`, error.code);
          if (
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered'
          ) {
            console.log(`⚠️ Token inválido ou não registrado:`, token);
          }
          return { success: false, token, error: error.code };
        }
      });

      const firebaseResults = await Promise.all(sendPromises);
      console.log('\n📊 Resumo do envio Firebase:');
      console.log(`✅ Enviadas com sucesso: ${firebaseResults.filter(r => r.success).length}`);
      console.log(`❌ Falhas: ${firebaseResults.filter(r => !r.success).length}\n`);
    }

    // Enviar para dispositivos Expo
    if (expoTokens.length > 0) {
      console.log(`Enviando notificação para ${expoTokens.length} dispositivos via Expo`);
      
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
            title: customTitle || 'Futuros Tech',
            body: messageText,
            sound: 'default',
            badge: 1,
            data: {
              sender: senderName,
              messageType: 'custom',
              message: messageText,
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
    console.error('❌ Erro ao enviar notificações:', error);
    throw error;
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
        title: title || 'Cxlus',
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
            title: title || 'Cxlus',
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

// Rota para enviar notificação para múltiplos emails
app.post('/send-notification-by-email', async (req, res) => {
  try {
    const { emails, message, title } = req.body;
    
    // Validar entrada
    if (!emails || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'Emails e mensagem são obrigatórios',
        details: 'Os campos emails (array) e message devem ser fornecidos no corpo da requisição'
      });
    }

    // Garantir que emails é um array
    const emailList = Array.isArray(emails) ? emails : [emails];

    // Resultado para cada email
    const results = {
      successful: [],
      failed: [],
      totalDevices: 0,
      devicesPerEmail: {}
    };

    // Processar cada email
    for (const email of emailList) {
      try {
        // Buscar dispositivos associados ao email
        const devices = await prisma.deviceToken.findMany({
          where: {
            email: email
          }
        });

        results.devicesPerEmail[email] = {
          deviceCount: devices.length,
          devices: devices.map(d => ({
            platform: d.platform,
            lastUpdated: d.lastUpdated,
            tokenType: d.deviceToken.includes('Expo') ? 'Expo' : 'Firebase'
          }))
        };

        if (devices.length === 0) {
          results.failed.push({
            email,
            error: 'Nenhum dispositivo encontrado',
            timestamp: new Date().toISOString()
          });
          continue;
        }

        console.log(`🔔 Enviando notificação para dispositivos do email: ${email}`);
        console.log(`📱 Dispositivos encontrados: ${devices.length}`);

        // Passar os dispositivos específicos para a função
        await sendFirebaseNotification(message, 'Email Notification', title, devices);

        results.successful.push({
          email,
          deviceCount: devices.length,
          timestamp: new Date().toISOString()
        });

        results.totalDevices += devices.length;

      } catch (error) {
        console.error(`❌ Erro ao processar email ${email}:`, error);
        results.failed.push({
          email,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Preparar resposta
    const response = {
      success: results.successful.length > 0,
      summary: {
        totalEmails: emailList.length,
        successfulEmails: results.successful.length,
        failedEmails: results.failed.length,
        totalDevices: results.totalDevices
      },
      successful: results.successful,
      failed: results.failed,
      deviceDetails: results.devicesPerEmail,
      timestamp: new Date().toISOString()
    };

    // Se alguns emails falharam mas outros tiveram sucesso, retornar 207 (Multi-Status)
    const statusCode = results.failed.length > 0 ? 
      (results.successful.length > 0 ? 207 : 500) : 
      200;

    res.status(statusCode).json(response);

  } catch (error) {
    console.error('❌ Erro ao enviar notificações:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao enviar notificações',
      details: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'desenvolvimento'}`);
  console.log('\nRotas disponíveis:');
  console.log('- GET  /health');
  console.log('- GET  /');
  console.log('- POST /register-device');
  console.log('- POST /send-notification');
  console.log('- POST /send-notification-by-email');
  console.log('- GET  /devices');
  console.log('- GET  /db-test');
  console.log('- POST /send-test-notification\n');

  // Iniciar o serviço de notificações agendadas
  startScheduledNotifications();
});

// 7. Limpar recursos ao encerrar
process.on('SIGINT', async () => {
  console.log('Encerrando servidor e conexões...');
  // Parar o serviço de notificações agendadas
  stopScheduledNotifications();
  await prisma.$disconnect();
  process.exit();
});