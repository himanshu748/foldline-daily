import { Hono } from 'hono';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { schedulerRoutes } from './routes/scheduler';
import { settingsRoutes } from './routes/settings';
import { triggers } from './routes/triggers';

export const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', schedulerRoutes);
internal.route('/settings', settingsRoutes);

app.route('/api', api);
app.route('/internal', internal);
