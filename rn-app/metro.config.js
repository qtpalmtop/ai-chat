/**
 * Metro bundler 配置
 * - 默认即可
 * - 如需自定义 resolver，可在此扩展
 */
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
