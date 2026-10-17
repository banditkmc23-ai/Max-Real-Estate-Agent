module.exports = {content:['./index.html'], theme: { extend: { colors: {
  brick: {
    50:'#fdf4ee', 100:'#f8e2d2', 200:'#f0c4a8',
    300:'#e6a88c', 400:'#cf7a56',
    500:'#b85c38', 600:'#a04d2c', 700:'#83401f', 800:'#5a2c15'
  },
  ink: '#1c1917',
  slate: {
    200:'#1c1917', 300:'#3f3733', 400:'#6b625a', 500:'#8a8078',
    700:'#e4dfd9', 800:'#f1eeea', 900:'#ffffff', 950:'#f4f2ef'
  }
} }, fontSize: {
  xs: ['11px', { lineHeight: '16px' }], sm: ['12.5px', { lineHeight: '18px' }], base: ['14px', { lineHeight: '20px' }],
  lg: ['15px', { lineHeight: '22px' }], xl: ['16px', { lineHeight: '24px' }], '2xl': ['19px', { lineHeight: '26px' }],
  '3xl': ['26px', { lineHeight: '32px' }], '4xl': ['30px', { lineHeight: '36px' }]
}, borderRadius: { xl: '16px', '2xl': '22px', '3xl': '30px' } } };
