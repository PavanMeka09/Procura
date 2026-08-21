import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { config } from '../utils/config';

const db = config.databaseUrl ? drizzle({ client: neon(config.databaseUrl) }) : null;

export default db;
