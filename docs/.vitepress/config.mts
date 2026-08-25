import { defineConfig } from 'vitepress';
export default defineConfig({
  title: 'Homeconnect Mqtt Bridge',
  description: 'MQTT bridge documentation',
  base: '/homeconnect-mqtt-bridge/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'MQTT', link: '/mqtt' },
      { text: 'Authentication', link: '/authentication' },
      { text: 'Deployment', link: '/deployment' },
    ],
    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'MQTT Contract', link: '/mqtt' },
      { text: 'Authentication', link: '/authentication' },
      { text: 'Deployment', link: '/deployment' },
      { text: 'Troubleshooting', link: '/troubleshooting' },
    ],
    editLink: {
      pattern: 'https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/tobiaswaelde/homeconnect-mqtt-bridge' }],
  },
});
