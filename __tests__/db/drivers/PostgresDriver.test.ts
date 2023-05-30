import {
  PostgresDriver,
  DbSchema,
  DbTable,
  DbColumn,
  DBType,
  GeneralColumnType,
  RdsDatabase,
  ConnectionSetting,
} from '../../../src';
import { init } from '../../setup/postgres';

const baseConnectOption = {
  host: '127.0.0.1',
  port: 6002,
  user: 'testuser',
  password: 'testpass',
  database: 'testdb',
};
const connectOption: ConnectionSetting = {
  ...baseConnectOption,
  dbType: DBType.Postgres,
  name: 'postgres',
};

// const CREATE_TABLE_STATEMENT = `
// CREATE TABLE testtable (
//   ID SERIAL NOT NULL PRIMARY KEY,
//   n0 BIT,
//   n1 INT,
//   n2 BIGINT,
//   n3 SMALLSERIAL,
//   n4 BIGSERIAL,
//   f1 NUMERIC(6,4),
//   f2 DOUBLE PRECISION,
//   f3 REAL,

//   d1 DATE,
//   d2 TIME,
//   d3 TIMESTAMP,
//   d4 TIMESTAMP WITH TIME ZONE,
//   d5 INTERVAL YEAR,

//   s1 CHAR(10),
//   s2 VARCHAR(10),
//   s3 TEXT,
//   s4 mood,
//   s5 BYTEA,
//   s6 uuid,

//   j1 JSON

// )`;

describe('PostgresDriver', () => {
  let driver: PostgresDriver;

  beforeAll(async () => {
    driver = createDriver();

    await init();
  });

  afterAll(async () => {
    await driver.disconnect();
    // client.end();
  });

  it('connect', async () => {
    expect(await driver.connect()).toBe('');
  });

  describe('getName', () => {
    it('should return constructor name', () => {
      expect(driver.getName()).toBe('PostgresDriver');
    });
  });

  describe('asyncGetResouces', () => {
    let testDbRes: RdsDatabase;
    let testSchemaRes: DbSchema;
    let testTableRes: DbTable;

    it('should return Database resource', async () => {
      const dbRootRes = await driver.getInfomationSchemas();
      testDbRes = dbRootRes.find((it) => it.name === 'testdb');
      expect(testDbRes.name).toBe(driver.getConnectionRes().database);
    });

    it('should have Schema resource', async () => {
      expect(testDbRes.children).toHaveLength(1);
      testSchemaRes = testDbRes.getSchema({ isDefault: true });
      expect(testSchemaRes.name).toBe('public');
    });

    it('should have Table resource', async () => {
      testTableRes = testSchemaRes.getChildByName('testtable') as DbTable;
      expect(testTableRes.name).toBe('testtable');
      expect(testTableRes.tableType).toBe('TABLE');
      expect(testTableRes.comment).toBe('table with various data types');
    });

    it('should have Column resource', async () => {
      // ID
      const idRes = testTableRes.getChildByName('ID', true) as DbColumn;
      expect(idRes.colType).toBe(GeneralColumnType.INTEGER);
      expect(idRes.nullable).toBe(false);
      expect(idRes.primaryKey).toBe(true);
      expect(idRes.default).toContain('nextval');
      // n0
      const n0Res = testTableRes.getChildByName('n0') as DbColumn;
      expect(n0Res.colType).toBe(GeneralColumnType.BIT);
      expect(n0Res.nullable).toBe(true);
      // n1
      const n1Res = testTableRes.getChildByName('n1') as DbColumn;
      expect(n1Res.colType).toBe(GeneralColumnType.INTEGER);
      expect(n1Res.nullable).toBe(true);
    });
  });

  function createDriver(): PostgresDriver {
    return new PostgresDriver(connectOption);
  }
});
