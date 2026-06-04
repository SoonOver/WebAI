import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { THEME, navigationTheme } from '../theme';
import { ErrorBoundary } from '../components/ErrorBoundary';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import LibraryScreen from '../screens/LibraryScreen';
import HistoryScreen from '../screens/HistoryScreen';
import DetailsScreen from '../screens/DetailsScreen';
import ReaderScreen from '../screens/ReaderScreen';
import SettingsScreen from '../screens/SettingsScreen';
import {
  canUseAppUpdates,
  checkForAppUpdate,
  reloadAppUpdate,
} from '../services/appUpdates';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Search: { focused: 'search', unfocused: 'search-outline' },
  Library: { focused: 'bookmark', unfocused: 'bookmark-outline' },
  History: { focused: 'time', unfocused: 'time-outline' },
  Settings: { focused: 'settings', unfocused: 'settings-outline' },
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          const iconName = focused ? icons.focused : icons.unfocused;
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: THEME.primary,
        tabBarInactiveTintColor: THEME.textMuted,
        tabBarStyle: {
          backgroundColor: THEME.surface,
          borderTopColor: THEME.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const stackScreenOptions = {
  headerStyle: {
    backgroundColor: THEME.surfaceElevated,
  },
  headerTintColor: THEME.text,
  headerTitleStyle: {
    fontWeight: '600',
    fontSize: 17,
  },
  headerShadowVisible: false,
  contentStyle: {
    backgroundColor: THEME.bg,
  },
};

const AUTO_UPDATE_COOLDOWN_MS = 30 * 60 * 1000;

function AutoUpdateManager() {
  const appStateRef = useRef(AppState.currentState);
  const checkingRef = useRef(false);
  const promptOpenRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  const runUpdateCheck = useCallback(async (reason = 'startup') => {
    if (!canUseAppUpdates() || checkingRef.current || promptOpenRef.current) return;

    const now = Date.now();
    const isStartup = reason === 'startup';
    if (!isStartup && now - lastCheckAtRef.current < AUTO_UPDATE_COOLDOWN_MS) return;

    checkingRef.current = true;
    lastCheckAtRef.current = now;
    try {
      const result = await checkForAppUpdate();
      if (result.status !== 'ready' || promptOpenRef.current) return;

      promptOpenRef.current = true;
      Alert.alert(
        'Update ready',
        'Update baru sudah terunduh. Restart app sekarang?',
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              promptOpenRef.current = false;
            },
          },
          {
            text: 'Restart',
            onPress: reloadAppUpdate,
          },
        ],
      );
    } catch {
      // OTA update checks are best-effort. A failed check must never block reading.
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    runUpdateCheck('startup');
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const returnedToForeground =
        nextState === 'active' &&
        (previousState === 'inactive' || previousState === 'background');
      if (returnedToForeground) runUpdateCheck('resume');
    });

    return () => subscription.remove();
  }, [runUpdateCheck]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <NavigationContainer theme={navigationTheme}>
          <Stack.Navigator screenOptions={stackScreenOptions}>
            <Stack.Screen
              name="Main"
              component={TabNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Details"
              component={DetailsScreen}
              options={{ title: 'Details' }}
            />
            <Stack.Screen
              name="Reader"
              component={ReaderScreen}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
          <AutoUpdateManager />
          <StatusBar style="light" />
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
