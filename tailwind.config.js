/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'brand-green': '#1DB954',
        'brand-black': '#121212',
        'surface':     '#1E1E1E',
        'surface-2':   '#2A2A2A',
        'muted':       '#B3B3B3',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
