import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#faf8f5',
        ink: '#1c1917',
        cocoa: {
          50: '#f8f4f0',
          100: '#ede3d8',
          500: '#7b5539',
          600: '#5f4029',
          700: '#4a3220',
          900: '#2b1d12',
        },
      },
    },
  },
  plugins: [],
};

export default config;
