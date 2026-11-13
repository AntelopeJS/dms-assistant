/** The engines the *Connect a database* form connects, by the name it sends to the module. */
export type DatabaseEngine = 'postgres' | 'mongodb' | 'rethinkdb'

/** How the form reaches one engine: its driver package, default port and URL schemes. */
interface EngineSpec {
	label: string
	package: string
	version: string
	port: string
	schemes: string[]
	/** Whether the URL's `sslmode` parameter is what the SSL switch stands for. */
	sslMode: boolean
	/** The raw-client interface the driver implements, which core must never offer from it. */
	rawInterface?: string
	/** Whether the driver reads the database from a variable of its own, beside the URL. */
	separateDatabase: boolean
}

export const ENGINES: Record<DatabaseEngine, EngineSpec> = {
	postgres: {
		label: 'PostgreSQL',
		package: '@antelopejs/postgres',
		version: '>=0.2.1 <1.0.0',
		port: '5432',
		schemes: ['postgres:', 'postgresql:'],
		sslMode: true,
		separateDatabase: false,
	},
	mongodb: {
		label: 'MongoDB',
		package: '@antelopejs/mongodb',
		version: '>=1.6.0 <2.0.0',
		port: '27017',
		schemes: ['mongodb:'],
		sslMode: false,
		rawInterface: '@antelopejs/interface-mongodb',
		separateDatabase: true,
	},
	rethinkdb: {
		label: 'RethinkDB',
		package: '@antelopejs/rethinkdb',
		version: '>=1.6.0 <2.0.0',
		port: '28015',
		schemes: ['rethinkdb:'],
		sslMode: false,
		rawInterface: '@antelopejs/interface-rethinkdb',
		separateDatabase: false,
	},
}
