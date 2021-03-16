module.exports = ({ env }) => ({
  plugins: [
    require('postcss-import'),
    require('postcss-nested'),
    require('tailwindcss'),
    require('autoprefixer'),
    env === 'production' ? require('cssnano')() : false,
  ],
});
