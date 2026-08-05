const express = require('express');
const userController = require('../controllers/user-controller');

const router = express.Router();

router.get('/:id', userController.getUser);

// Routes carrying middleware — i.e. most real Express routes. These exist so
// the fixture exercises route arities ABOVE 2. Every route in this fixture was
// previously two-argument, and `argc - 1 == 1` is exactly the arity at which
// the v0.1.0 duplicate-match defect was invisible: an unanchored
// `(_) @route.handler` bound once per argument after the path, so these three
// lines each emitted 2, 3 and 4 identical `route` symbols respectively, all
// colliding on `symbol.id`. See docs/DECISIONS.md.
router.post('/', validateBody, userController.createUser);
router.patch('/:id', requireAuth, validateBody, userController.updateUser);
router.delete('/:id', requireAuth, requireAdmin, auditLog, userController.deleteUser);

module.exports = router;
