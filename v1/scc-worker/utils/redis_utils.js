const redis = require('redis');
const config = require('../config.json');

function create_redis_client() {
  let options = {
    port: config.redis_port,
    host: config.redis_host
  };
  if (config.redis_password) {
    options.password = config.redis_password;
  }

  return redis.createClient(options);
}

module.exports = {
  create_redis_client: create_redis_client
};
