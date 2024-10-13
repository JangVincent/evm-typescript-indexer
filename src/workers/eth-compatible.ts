import { blockchain, PrismaClient } from '@prisma/client';
import { BaseError, createPublicClient, http } from 'viem';
import * as viemChains from 'viem/chains';
import { parentPort } from 'worker_threads';

import dayjs from 'dayjs';
import { tx } from '../types';
import { sleep } from '../utils';

function getChain(chainId: number): viemChains.Chain | null {
  const chains = viemChains as object;
  for (let chain of Object.entries(chains)) {
    if (chain[1].id === chainId) {
      return chain[1];
    }
  }

  return null;
}

parentPort?.on('message', async (blockChain: blockchain) => {
  const prisma = new PrismaClient();

  const chain = getChain(Number(blockChain.chainId));
  if (!chain) {
    console.error(`Chain not found for id ${blockChain.chainId}`);
    return;
  }

  let currentBlock: bigint = BigInt(blockChain.startBlock || 0);

  const indexingLog = await prisma.indexingLog.findUnique({
    where: {
      chainId: blockChain.chainId,
    },
  });

  if (indexingLog) {
    currentBlock = BigInt(indexingLog.blockNumber);
  }

  const indexingTarget = await prisma.target.findMany({
    where: {
      chainId: blockChain.chainId,
    },
  });

  if (indexingTarget.length === 0) {
    parentPort?.postMessage(`${chain.name} target contract not found`);
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  while (true) {
    if (
      blockChain.endBlock !== null &&
      currentBlock > BigInt(blockChain.endBlock)
    ) {
      break;
    }

    try {
      let parsedTxs: tx[] = [];

      // #1. Get block
      const block = await publicClient.getBlock({
        blockNumber: currentBlock,
        includeTransactions: true,
      });
      const blockDate = dayjs(Number(block.timestamp) * 1000);

      for (const tx of block.transactions) {
        // #2. Check the transaction's "to" address
        if (
          !indexingTarget.find(
            (t) => t.address.toLowerCase() === tx.to?.toLowerCase(),
          )
        ) {
          continue;
        }

        // #3. Check the transaction's "input" signature
        if (
          !indexingTarget.find(
            (t) => t.methodSignature.toLowerCase() === tx.input.toLowerCase(),
          )
        ) {
          continue;
        }

        // #4. Get the transaction receipt
        const receipt = await publicClient.getTransactionReceipt({
          hash: tx.hash,
        });

        // #5. Check the transaction status
        if (receipt.status !== 'success') {
          console.group();
          console.log(`⏭️ Skipped : failed transaction`);
          console.log(
            `📦 Chain : ${chain.name}-${blockChain.chainId} / Block Num : ${block.number}`,
          );
          console.log(`🔗 ${tx.hash}`);
          console.groupEnd();
          continue;
        }

        // #6. Collect the transaction
        parsedTxs.push({
          chainId: blockChain.chainId,
          blockHash: tx.blockHash,
          blockNumber: tx.blockNumber.toString(),
          hash: tx.hash,
          from: tx.from,
          to: tx.to || '',
          input: tx.input,
          value: tx.value.toString(),
          timestamp: blockDate.format('YYYY-MM-DD HH:mm:ss'),
        });
      }

      // #7. Save the transactions
      for (let tx of parsedTxs) {
        await prisma.transaction.upsert({
          where: {
            chainId_hash_unique: {
              chainId: tx.chainId,
              hash: tx.hash,
            },
          },
          update: tx,
          create: tx,
        });
      }

      // #8. Update/Insert the indexing log
      await prisma.indexingLog.upsert({
        where: {
          chainId: blockChain.chainId,
        },
        update: {
          blockHash: block.hash,
          blockNumber: Number(block.number),
        },
        create: {
          chainId: blockChain.chainId,
          blockHash: block.hash,
          blockNumber: Number(block.number),
        },
      });

      currentBlock += BigInt(1);
      await sleep(blockChain.sleepPerBlock);
    } catch (e) {
      console.log(e);
      if (e instanceof BaseError) {
        console.error(`${chain.name} Error : ${e.shortMessage}`);
      }
      if (e instanceof Error) {
        console.error(`${chain.name} Error : ${e.message}`);
      }
      await sleep(blockChain.sleepWhenBlockNotFound);
    }
  }

  parentPort?.postMessage(`${chain.name} indexing stopped`);
});
