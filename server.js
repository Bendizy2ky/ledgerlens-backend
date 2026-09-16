import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: '*' });

fastify.get('/health', async (request, reply) => {
  const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  return { status: 'ok', memoryUsage: `${memoryMB} MB` };
});

const start = async () => {
  try {
    const port = process.env.PORT || 10000;
    await fastify.listen({ port: Number(port), host: '0.0.0.0' });
    console.log(`Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();