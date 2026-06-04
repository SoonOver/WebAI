import { DarkTheme } from '@react-navigation/native';

// Theme constants for the entire app
export const THEME = {
  bg: '#0B1120',
  surface: '#121A2B',
  surfaceElevated: '#1A2438',
  border: '#2A3754',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  danger: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 },
};

export const navigationTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: THEME.primary,
    background: THEME.bg,
    card: THEME.surfaceElevated,
    text: THEME.text,
    border: THEME.border,
    notification: THEME.primary,
  },
};
