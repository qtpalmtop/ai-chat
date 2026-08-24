module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-worklets 必须放在最后
      // 用于 reanimated v4 的 worklet 编译
      'react-native-worklets/plugin',
    ],
  };
};
