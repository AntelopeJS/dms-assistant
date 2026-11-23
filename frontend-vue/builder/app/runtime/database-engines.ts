/** The engines the *Connect a database* form connects, by the name it sends to the module. */
export const DATABASE_ENGINES = ['postgres', 'mongodb', 'rethinkdb', 'mysql'] as const

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number]

interface EngineSpec {
	label: string
	port: string
	schemes: string[]
	/** The raw-client interface the driver implements, which core must never offer from it. */
	rawInterface?: string
	/** Whether the driver reads the database from a variable of its own, beside the URL. */
	separateDatabase: boolean
}

export const ENGINES: Record<DatabaseEngine, EngineSpec> = {
	postgres: {
		label: 'PostgreSQL',
		port: '5432',
		schemes: ['postgres:', 'postgresql:'],
		separateDatabase: false,
	},
	mongodb: {
		label: 'MongoDB',
		port: '27017',
		schemes: ['mongodb:', 'mongodb+srv:'],
		rawInterface: '@antelopejs/interface-mongodb',
		separateDatabase: true,
	},
	rethinkdb: {
		label: 'RethinkDB',
		port: '28015',
		schemes: ['rethinkdb:'],
		rawInterface: '@antelopejs/interface-rethinkdb',
		separateDatabase: false,
	},
	mysql: {
		label: 'MySQL / MariaDB',
		port: '3306',
		schemes: ['mysql:'],
		separateDatabase: false,
	},
}
