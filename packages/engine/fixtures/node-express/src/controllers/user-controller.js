const UserModel = require('../models/user-model');

function getUser(req, res) {
  const user = UserModel.findById(req.params.id);
  res.json(user);
}

module.exports = { getUser };
