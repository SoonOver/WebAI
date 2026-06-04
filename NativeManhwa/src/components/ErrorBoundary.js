import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../theme';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Ionicons name="bug-outline" size={48} color={THEME.danger} />
          <Text style={styles.title}>Terjadi Kesalahan</Text>
          <Text style={styles.subtitle}>
            {this.state.error?.message || 'Terjadi error yang tidak terduga'}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null })}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonLabel}>Coba Lagi</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bg,
    padding: THEME.space.xl,
  },
  title: {
    color: THEME.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: THEME.space.lg,
    textAlign: 'center',
  },
  subtitle: {
    color: THEME.textSecondary,
    fontSize: 14,
    marginTop: THEME.space.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: THEME.space.xl,
  },
  button: {
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.xl * 2,
    borderRadius: THEME.radius.md,
  },
  buttonLabel: { color: THEME.text, fontWeight: '700', fontSize: 15 },
});
