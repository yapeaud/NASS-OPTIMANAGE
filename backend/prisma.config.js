import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

export default defineConfig({
    earlyAccess: true,
    schema: 'prisma/schema.prisma',
    migrate: {
        async adapter(env) {
            const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
            return new PrismaPg(pool);
        }
    }
});
