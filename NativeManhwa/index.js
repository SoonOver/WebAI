import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import React from 'react';
import { StyleSheet } from 'react-native';

import App from './src/navigation/AppNavigator';

function Root() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <App />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

registerRootComponent(Root);
