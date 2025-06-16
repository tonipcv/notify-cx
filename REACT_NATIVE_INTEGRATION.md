# 📱 Integração React Native - Servidor de Notificações iOS

## 🎯 Objetivo
Integrar o servidor de notificações com o app React Native para registrar tokens FCM quando o usuário fizer login.

## 🔧 Configuração Inicial

### 1. Instalar Dependências
```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
# Para iOS
cd ios && pod install
```

### 2. Configurar Firebase no Projeto

#### Android (`android/app/google-services.json`)
- Baixar o arquivo `google-services.json` do Firebase Console
- Colocar em `android/app/google-services.json`

#### iOS (`ios/GoogleService-Info.plist`)
- Baixar o arquivo `GoogleService-Info.plist` do Firebase Console
- Adicionar ao projeto iOS via Xcode

## 📝 Implementação

### 1. Serviço de Notificações (`services/NotificationService.js`)

```javascript
import messaging from '@react-native-firebase/messaging';
import { Platform, Alert } from 'react-native';

class NotificationService {
  constructor() {
    this.serverUrl = 'https://aa-ios-notify-cxlus.dpbdp1.easypanel.host';
  }

  // Solicitar permissão para notificações
  async requestPermission() {
    try {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('✅ Permissão de notificação concedida');
        return true;
      } else {
        console.log('❌ Permissão de notificação negada');
        return false;
      }
    } catch (error) {
      console.error('Erro ao solicitar permissão:', error);
      return false;
    }
  }

  // Obter token FCM
  async getFCMToken() {
    try {
      const token = await messaging().getToken();
      console.log('🔑 Token FCM obtido:', token);
      return token;
    } catch (error) {
      console.error('Erro ao obter token FCM:', error);
      return null;
    }
  }

  // Registrar dispositivo no servidor
  async registerDevice(userId, email = null) {
    try {
      // 1. Solicitar permissão
      const hasPermission = await this.requestPermission();
      if (!hasPermission) {
        throw new Error('Permissão de notificação não concedida');
      }

      // 2. Obter token FCM
      const deviceToken = await this.getFCMToken();
      if (!deviceToken) {
        throw new Error('Não foi possível obter o token FCM');
      }

      // 3. Registrar no servidor
      const response = await fetch(`${this.serverUrl}/register-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceToken,
          userId,
          email,
          platform: Platform.OS, // 'ios' ou 'android'
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log('✅ Dispositivo registrado com sucesso:', data.data);
        return {
          success: true,
          data: data.data,
        };
      } else {
        throw new Error(data.error || 'Erro ao registrar dispositivo');
      }
    } catch (error) {
      console.error('❌ Erro ao registrar dispositivo:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Configurar listeners de notificação
  setupNotificationListeners() {
    // Notificação recebida quando app está em foreground
    messaging().onMessage(async remoteMessage => {
      console.log('📱 Notificação recebida (foreground):', remoteMessage);
      
      // Mostrar alerta ou notificação local
      Alert.alert(
        remoteMessage.notification?.title || 'Nova Notificação',
        remoteMessage.notification?.body || 'Você tem uma nova mensagem'
      );
    });

    // Notificação tocada quando app está em background
    messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('📱 Notificação tocada (background):', remoteMessage);
      // Navegar para tela específica se necessário
    });

    // Verificar se app foi aberto por uma notificação
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('📱 App aberto por notificação:', remoteMessage);
          // Navegar para tela específica se necessário
        }
      });

    // Listener para refresh do token
    messaging().onTokenRefresh(token => {
      console.log('🔄 Token FCM atualizado:', token);
      // Aqui você pode re-registrar o dispositivo com o novo token
    });
  }
}

export default new NotificationService();
```

### 2. Hook para Gerenciar Notificações (`hooks/useNotifications.js`)

```javascript
import { useEffect, useState } from 'react';
import NotificationService from '../services/NotificationService';

export const useNotifications = () => {
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Configurar listeners quando o componente montar
    NotificationService.setupNotificationListeners();
  }, []);

  const registerForNotifications = async (userId, email = null) => {
    setLoading(true);
    try {
      const result = await NotificationService.registerDevice(userId, email);
      
      if (result.success) {
        setIsRegistered(true);
        return { success: true, data: result.data };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    isRegistered,
    loading,
    registerForNotifications,
  };
};
```

### 3. Integração na Tela de Login (`screens/LoginScreen.js`)

```javascript
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useNotifications } from '../hooks/useNotifications';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { registerForNotifications, loading: notificationLoading } = useNotifications();

  const handleLogin = async () => {
    setLoading(true);
    
    try {
      // 1. Fazer login normal (sua lógica existente)
      const loginResponse = await fetch('https://sua-api.com/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const loginData = await loginResponse.json();

      if (loginResponse.ok && loginData.success) {
        // 2. Login bem-sucedido - registrar para notificações
        console.log('✅ Login realizado com sucesso');
        
        // 3. Registrar dispositivo para notificações
        const notificationResult = await registerForNotifications(
          loginData.user.id, // ID do usuário
          loginData.user.email // Email do usuário
        );

        if (notificationResult.success) {
          console.log('✅ Dispositivo registrado para notificações');
        } else {
          console.warn('⚠️ Falha ao registrar notificações:', notificationResult.error);
          // Não bloquear o login por causa das notificações
        }

        // 4. Navegar para tela principal
        navigation.navigate('Home');
        
      } else {
        Alert.alert('Erro', loginData.message || 'Credenciais inválidas');
      }
    } catch (error) {
      console.error('❌ Erro no login:', error);
      Alert.alert('Erro', 'Erro ao fazer login. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, marginBottom: 30, textAlign: 'center' }}>
        Login
      </Text>
      
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: '#ddd',
          padding: 15,
          marginBottom: 15,
          borderRadius: 8,
        }}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: '#ddd',
          padding: 15,
          marginBottom: 20,
          borderRadius: 8,
        }}
        placeholder="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      
      <TouchableOpacity
        style={{
          backgroundColor: loading || notificationLoading ? '#ccc' : '#007AFF',
          padding: 15,
          borderRadius: 8,
          alignItems: 'center',
        }}
        onPress={handleLogin}
        disabled={loading || notificationLoading}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>
          {loading || notificationLoading ? 'Entrando...' : 'Entrar'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default LoginScreen;
```

### 4. Configuração no App Principal (`App.js`)

```javascript
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import messaging from '@react-native-firebase/messaging';
import { Alert } from 'react-native';

import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';

const Stack = createStackNavigator();

const App = () => {
  useEffect(() => {
    // Solicitar permissão para notificações no iOS
    const requestPermission = async () => {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('✅ Permissão concedida:', authStatus);
      }
    };

    requestPermission();

    // Listener para quando app está fechado e é aberto por notificação
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('App aberto por notificação:', remoteMessage);
        }
      });
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
```

## 🔍 Testando a Integração

### 1. Verificar se o Token foi Registrado
```javascript
// No seu componente, adicione um botão de teste:
const testNotification = async () => {
  try {
    const response = await fetch('https://aa-ios-notify-cxlus.dpbdp1.easypanel.host/devices');
    const data = await response.json();
    console.log('Dispositivos registrados:', data);
  } catch (error) {
    console.error('Erro ao buscar dispositivos:', error);
  }
};
```

### 2. Enviar Notificação de Teste
```bash
curl -X POST https://aa-ios-notify-cxlus.dpbdp1.easypanel.host/send-notification \
  -H "Content-Type: application/json" \
  -d '{"title": "Teste App", "message": "Notificação do React Native funcionando!"}'
```

## 🚨 Pontos Importantes

### 1. **Permissões iOS**
- Adicionar no `ios/YourApp/Info.plist`:
```xml
<key>UIBackgroundModes</key>
<array>
  <string>remote-notification</string>
</array>
```

### 2. **Tratamento de Erros**
- Sempre verificar se o usuário concedeu permissão
- Tratar casos onde o token FCM não pode ser obtido
- Não bloquear o login se o registro de notificação falhar

### 3. **Atualização de Token**
- Implementar listener para `onTokenRefresh`
- Re-registrar dispositivo quando token mudar

### 4. **Logout**
- Considerar remover o token do servidor no logout:
```javascript
const logout = async () => {
  // Sua lógica de logout
  
  // Opcional: remover token do servidor
  // await fetch(`${serverUrl}/unregister-device`, { ... });
};
```

## 📊 Fluxo Completo

1. **Usuário abre o app** → Solicita permissão para notificações
2. **Usuário faz login** → Obtém token FCM
3. **Token é registrado** → Enviado para servidor com userId e email
4. **Servidor salva** → Token fica associado ao usuário
5. **Notificações funcionam** → Servidor pode enviar notificações para o usuário

## 🔗 Endpoints Disponíveis

- **Registrar dispositivo**: `POST /register-device`
- **Enviar notificação**: `POST /send-notification`
- **Listar dispositivos**: `GET /devices`
- **Health check**: `GET /health`

**Servidor**: https://aa-ios-notify-cxlus.dpbdp1.easypanel.host/ 