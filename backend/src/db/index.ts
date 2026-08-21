import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { config } from '../utils/config';

const sql = neon(config.databaseUrl!);
const db = drizzle({ client: sql });

export default db;