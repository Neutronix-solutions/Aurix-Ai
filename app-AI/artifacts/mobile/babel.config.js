module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      // react-native-reanimated/plugin is required on New Architecture (Reanimated 4.x)
      // for worklet transformation on both iOS and Android.
      "react-native-reanimated/plugin",
    ],
  };
};
