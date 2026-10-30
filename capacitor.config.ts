/// <reference types="@capacitor/push-notifications" />
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orbitmadar.madarflow',
  appName: 'Madar Flow',
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['banner', 'list', 'badge', 'sound'],
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
    LiveUpdates: {
      appId: '1e7b36fa',
      channel: 'Production',
      autoUpdateMethod: 'background',
      maxVersions: 2,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
    },
    GoogleAuth: {
      scopes: [
        'profile',
        'email',
        'https://www.googleapis.com/auth/drive.file',
      ],
      serverClientId:
        '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
