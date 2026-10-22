import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import HomeScreen from '../screens/HomeScreen';
import CaptionsScreen from '../screens/CaptionsScreen';
import ReplyScreen from '../screens/ReplyScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HuntScreen from '../screens/HuntScreen';
import ReelScreen from '../screens/ReelScreen';
import LivingRoomScreen from '../screens/LivingRoomScreen';
import ChannelWallScreen from '../screens/ChannelWallScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false, animation: 'fade', gestureEnabled: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Captions" component={CaptionsScreen} />
      <Stack.Screen name="Reply" component={ReplyScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Hunt" component={HuntScreen} />
      <Stack.Screen name="Reel" component={ReelScreen} />
      <Stack.Screen name="LivingRoom" component={LivingRoomScreen} />
      <Stack.Screen name="ChannelWall" component={ChannelWallScreen} />
    </Stack.Navigator>
  );
}
