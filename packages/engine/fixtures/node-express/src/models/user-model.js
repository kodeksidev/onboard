const users = [{ id: '1', name: 'Ada' }];

function findById(id) {
  return users.find((user) => user.id === id) ?? null;
}

module.exports = { findById };
