# MotionMates — Fire TV app

React Native TV application for MotionMates, built on Amazon's
[react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample)
(commit `d435082`, MIT-0).

Kept from the starter: the Yarn workspace layout, the Expo + `react-native-tvos` app shell
(`apps/expo-multi-tv`), the config plugins, the `react-tv-space-navigation` focus management, the
`RemoteControlManager` key handling, the theme tokens and the 1920×1080 `scaledPixels` helper.

Replaced: the movie catalogue screens, drawer and video player → the eight MotionMates screens in
`packages/shared-ui/src/screens` and the game/memory code in `packages/shared-ui/src/mm`.

Removed: `apps/vega` (cannot be built on Windows; see `../docs/SETUP.md`).

```
apps/expo-multi-tv/        Expo app shell (Fire OS / Android TV / web)
packages/shared-ui/src/
  app/remote-control/      remote key handling (from the starter) + useBackOverride
  navigation/              native-stack navigator with the 8 screens
  screens/                 MainMenu, Pairing, Calibration, Game, Summary, Gallery, Replay, Settings
  mm/                      api, TvLink (WebSocket), GameRunner, GameView, widgets, state
```

Setup, build and run instructions: [`../docs/SETUP.md`](../docs/SETUP.md).
