/**
 * 根导航：createNativeStackNavigator
 * - HomeScreen：工具列表
 * - WebViewScreen：加载 WebView
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { HomeScreen } from '../screens/HomeScreen';
import { WebViewScreen } from '../screens/WebViewScreen';
import { colors } from '../constants';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'AI 工具箱' }}
        />
        <Stack.Screen
          name="WebView"
          component={WebViewScreen}
          options={({ route }) => ({ title: route.params.tool.name })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
