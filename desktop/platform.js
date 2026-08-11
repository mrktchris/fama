'use strict';

const PLATFORM_INFO = Object.freeze({
  darwin: Object.freeze({
    id: 'darwin',
    name: 'macOS',
    startupLabel: 'Launch Fama when you log in',
    voiceLabel: 'free (Mac voice)',
    supportsDesktopShortcut: false,
  }),
  win32: Object.freeze({
    id: 'win32',
    name: 'Windows',
    startupLabel: 'Launch Fama when Windows starts',
    voiceLabel: 'free (Windows voice)',
    supportsDesktopShortcut: true,
  }),
  linux: Object.freeze({
    id: 'linux',
    name: 'Linux',
    startupLabel: 'Launch Fama when you log in',
    voiceLabel: 'free (system voice)',
    supportsDesktopShortcut: false,
  }),
});

function desktopPlatformInfo(platform = process.platform) {
  return PLATFORM_INFO[platform] || Object.freeze({
    id: platform || 'unknown',
    name: 'Desktop',
    startupLabel: 'Launch Fama when you log in',
    voiceLabel: 'free (system voice)',
    supportsDesktopShortcut: false,
  });
}

module.exports = { desktopPlatformInfo, PLATFORM_INFO };
