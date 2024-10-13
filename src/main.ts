import { blockchain, PrismaClient } from '@prisma/client';
import path from 'path';
import { Worker } from 'worker_threads';

const prisma = new PrismaClient();

async function runService(blockchain: blockchain) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, 'workers', 'eth-compatible.js'),
    );

    worker.postMessage(blockchain);

    worker.on('message', async (message) => {
      resolve(message);
    });

    worker.on('error', (e) => {
      reject(e);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

async function main() {
  const blockChain = await prisma.blockchain.findMany();

  if (!blockChain || blockChain.length === 0) {
    console.error('Chain not found');
    return;
  }

  try {
    const results = blockChain.map(async (chain) => {
      return await runService(chain);
    });

    console.log(results);
  } catch (e) {
    console.log(e);
  }
}

main()
  .then(async () => {})
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  });
