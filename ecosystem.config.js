module.exports = {
  apps: [
    {
      name: 'shy-template-server',
      script: './dist/main.js',
      env_prod: {
        NODE_ENV: 'prod',
      },
      env_dev: {
        NODE_ENV: 'dev',
      },
    },
  ],
};
