module.exports = {
  plugins: ['node'],
  extends: ['eslint:recommended', 'plugin:node/recommended'],
  env: {
    node: true,
    es6: true
  },
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module'
  },
  rules: {
    'no-trailing-spaces': 1,
    'space-before-blocks': 1,
    'arrow-parens': ['error', 'always'],
    curly: ['error', 'all'],
    'dot-location': ['error', 'property'],
    eqeqeq: ['error', 'always'],
    'no-floating-decimal': 1,
    yoda: ['error', 'never'],
    'no-undef-init': 1,
    // "no-use-before-define":  ["error", "nofunc"],
    'block-spacing': ['error', 'always'],
    'comma-spacing': 1,
    'func-call-spacing': 1,
    'key-spacing': 1,
    'keyword-spacing': 1,
    'no-whitespace-before-property': 1,
    'nonblock-statement-body-position': 1,
    'object-curly-spacing': ['error', 'always'],
    'semi-spacing': ['error', { before: false, after: true }],
    'space-infix-ops': ['error', { int32Hint: false }],
    'space-unary-ops': 1,
    'switch-colon-spacing': 1,
    'security/detect-object-injection': 0
  },
  globals: {
    require: false,
    module: false
  }
};
