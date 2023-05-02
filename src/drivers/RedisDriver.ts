/* eslint-disable @typescript-eslint/no-unused-vars */

import { Redis } from 'ioredis';
import { BaseDriver, RequestSqlOptions, Scannable } from './BaseDriver';
import {
  DbConnection,
  DbDatabase,
  DbKey,
  RdhKey,
  RedisDatabase,
  RedisKeyParams,
  ResultSetDataHolder,
} from '../resource';
import { GeneralColumnType, RedisKeyType, ScanParams } from '../types';

export class RedisDriver extends BaseDriver implements Scannable {
  client: Redis | undefined;

  constructor(conRes: DbConnection) {
    super(conRes);
  }

  async connectSub(): Promise<string> {
    try {
      const options: any = Object.assign(
        {
          port: 6379, // Redis port
          host: '127.0.0.1', // Redis host
          password: 'auth',
          db: 0,
        },
        {
          port: this.conRes.port,
          host: this.conRes.host,
          password: this.conRes.password,
          db: this.conRes.database,
          retryStrategy: function () {
            return 'No!';
          },
        },
      );
      if (this.isNeedsSsh()) {
        options.host = '127.0.0.1';
        options.port = this.sshLocalPort;
      }
      options.connectTimeout = 5_000;
      if (this.conRes.hasUrl()) {
        // Connect to 127.0.0.1:6380, db 4, using password "authpassword":
        // "redis://:authpassword@127.0.0.1:6380/4"
        this.client = new Redis(this.conRes.url);
      } else {
        this.client = new Redis(options);
      }
      await this.client.ping(); // test
    } catch (e) {
      return `failed to connect:${e.message}`;
    }

    return '';
  }

  async test(with_connect = false): Promise<string> {
    let errorReason = '';
    try {
      if (with_connect) {
        const con_result = await this.connect();
        if (con_result) {
          return con_result;
        }
      }
      await this.client.ping();
      if (with_connect) {
        await this.disconnect();
      }
    } catch (e) {
      errorReason = e.message;
    }
    return errorReason;
  }

  // async executeCommand(req: RedisRequest): Promise<DbKey | string | number> {
  //   let ret: DbKey | string | number = '';
  //   if (!this.client) {
  //     return ret;
  //   }
  //   await this.client.select(req.index);
  //   let r: any = '';
  //   switch (req.command) {
  //     case RedisCommandType.GetValue:
  //       {
  //         r = await this.getValueByKey(this.client, req.key, req.type);
  //         const ttl = await this.client.ttl(req.key);
  //         ret = new DbKey(req.key, req.type, ttl);
  //         if (ret.ttl > 0) {
  //           ret.ttlConfirmationDatetime = new Date().getTime();
  //         }
  //         ret.val = r;
  //       }
  //       break;
  //     case RedisCommandType.SetValue:
  //       if (req.options) {
  //         await this.client.set(req.key, req.options.val);
  //       }
  //       break;
  //     case RedisCommandType.Flushall:
  //       ret = await this.client.flushall();
  //       break;
  //     case RedisCommandType.Flushdb:
  //       ret = await this.client.flushdb();
  //       break;
  //     case RedisCommandType.Dbsize:
  //       ret = await this.client.dbsize();
  //       break;
  //     case RedisCommandType.Info:
  //       ret = await this.client.info(<string>req.options.section);
  //       break;
  //     case RedisCommandType.Del:
  //       ret = await this.client.del(<string>req.key);
  //       break;
  //     default:
  //       console.error('undefined.', req.command);
  //       break;
  //   }
  //   return ret;
  // }

  async scanStream(params: ScanParams): Promise<DbKey<RedisKeyParams>[]> {
    const { target, limit, withValue, keyword } = params;

    await this.client.select(target);
    const keys = await new Promise<string[]>((resolve) => {
      const stream = this.client.scanStream({
        match: keyword,
        count: limit,
      });
      const keys: string[] = [];

      stream.on('data', (resultKeys: string[]) => {
        resultKeys.forEach((key) => {
          keys.push(key);
        });

        if (keys.length > limit) {
          (<any>stream).close(); // ScanStream.close()
        }
      });
      stream.on('end', () => {
        if (keys.length > limit) {
          keys.splice(limit - 1, keys.length - limit);
        }
        resolve(keys);
      });
    });

    const promises = keys.map(async (key) => {
      const type = (await this.client.type(key)) as RedisKeyType;
      const ttl = await this.client.ttl(key);
      let val: any;
      if (withValue) {
        val = await this.getValueByKey(this.client, key, type);
      }
      return new DbKey<RedisKeyParams>(key, {
        type,
        ttl,
        val,
      });
    });
    return await Promise.all(promises);
  }

  async scan(params: ScanParams): Promise<ResultSetDataHolder> {
    const dbKeys = await this.scanStream(params);

    const rdh = new ResultSetDataHolder([
      new RdhKey('key', GeneralColumnType.TEXT),
      new RdhKey('type', GeneralColumnType.ENUM),
      new RdhKey('ttl', GeneralColumnType.INTEGER),
      new RdhKey('val', GeneralColumnType.UNKNOWN),
    ]);
    dbKeys.forEach((dbKey) => {
      rdh.addRow({
        ...dbKey.params,
        key: dbKey.getName(),
      });
    });
    return rdh;
  }

  async getValueByKey(
    client: Redis,
    key: string,
    type: RedisKeyType,
  ): Promise<any> {
    switch (type) {
      case RedisKeyType.string:
        return await client.get(key);
      case RedisKeyType.list:
        return await client.lrange(key, 0, -1);
      case RedisKeyType.set:
        return await client.smembers(key);
      case RedisKeyType.zset:
        return await client.zrange(key, 0, -1);
      case RedisKeyType.hash:
        return await client.hgetall(key);
      default:
        console.log('whattype??', type);
    }
    return undefined;
  }
  async getInfomationSchemas(): Promise<Array<DbDatabase>> {
    if (!this.conRes) {
      return [];
    }
    const dbResources = new Array<DbDatabase>();

    const keyspace = await this.client.info('keyspace');
    // db0:keys=7,expires=0,avg_ttl=0
    // db3:keys=1,expires=1,avg_ttl=4996199
    const re = /db([0-9]+):keys=([0-9]+),expires=([0-9]+),avg_ttl=([0-9]+)/g;
    let m: string[];
    while ((m = re.exec(keyspace))) {
      const db = m[1];
      const keys = parseInt(m[2], 10);
      const dbRes = new RedisDatabase(db, keys);
      dbResources.push(dbRes);
    }

    return dbResources;
  }
  async closeSub(): Promise<string> {
    if (this.client) {
      await this.client.quit();
    }
    return '';
  }
}