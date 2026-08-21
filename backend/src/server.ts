import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
dotenv.config();
import db from './db';
import { config } from './utils/config';

const server = fastify();

server.register(cors, {
  origin: '*',
});

server.get('/', (req, res) => {
  res.send('Hello World');
});

server.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  
  console.log(`Server is running on ${address}`);
});