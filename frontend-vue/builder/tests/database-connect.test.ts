import { describe, expect, it } from 'vitest'
import {
	type ConnectForm,
	connectSteps,
	connectVariables,
	connectionUrl,
	connectionId,
	engineOfScheme,
	fieldProblem,
	managedNames,
	missingField,
	parseConnectionUrl,
} from '../app/runtime/database-connect'
import type { DriverPackage, ProjectModules } from '../app/runtime/database-types'

const FIELDS = parseConnectionUrl('postgres', 'postgres://reader:s3cret@db.example:5432/erp')

const POSTGRES_DRIVER: DriverPackage = { package: '@antelopejs/postgres', version: '>=0.2.6 <0.3.0' }

function form(overrides: Partial<ConnectForm> = {}): ConnectForm {
	return {
		name: 'ERP',
		engine: 'postgres',
		fields: FIELDS,
		overrides: {},
		...overrides,
	}
}

function project(overrides: Partial<ProjectModules> = {}): ProjectModules {
	return { modules: [], self: 'dms', databasePins: [], drivers: {}, ...overrides }
}

describe('the names the builder manages for a connection', () => {
	it('follows the name under a prefix no ordinary module uses', () => {
		expect(managedNames(form({ name: 'Client ERP' }))).toEqual({
			driverModule: 'builder-db-client-erp',
			tablesModule: 'builder-db-client-erp-tables',
			variable: 'BUILDER_DB_CLIENT_ERP_URL',
			databaseVariable: 'BUILDER_DB_CLIENT_ERP_DATABASE',
		})
	})

	it('folds accents rather than splitting the word', () => {
		expect(connectionId('Données Comptabilité')).toBe('donnees-comptabilite')
	})

	it('keeps a name the integrator changed, and derives the others', () => {
		const steps = connectSteps(form({ overrides: { tablesModule: 'erp-tables' } }), project(), POSTGRES_DRIVER)
		expect(steps.map((step) => `${step.op}:${step.id}`)).toEqual([
			'AddModule:builder-db-erp',
			'CreateLocalModule:erp-tables',
			'ConfigureModule:dms',
		])
	})
})

describe('the wiring of a database', () => {
	it('adds the driver at the range the project gives, below every other database provider, and touches no other module than the DMS', () => {
		const [driver, tables, dms] = connectSteps(form(), project({ modules: ['mongodb', 'dms'] }), POSTGRES_DRIVER)
		expect(driver).toMatchObject({
			op: 'AddModule',
			entry: {
				source: { type: 'package', package: '@antelopejs/postgres', version: '>=0.2.6 <0.3.0' },
				env: { url: 'BUILDER_DB_ERP_URL' },
				exportPriority: { '@antelopejs/interface-database': -1 },
			},
		})
		expect(tables).toMatchObject({
			path: 'modules/builder-db-erp-tables',
			entry: { importOverrides: [{ interface: '@antelopejs/interface-database', source: 'builder-db-erp' }] },
		})
		expect(dms).toMatchObject({ id: 'dms' })
	})

	it('declares the connection on the id the project gives @antelopejs/dms', () => {
		const steps = connectSteps(
			form(),
			project({ modules: ['@antelopejs/dms'], self: '@antelopejs/dms' }),
			POSTGRES_DRIVER,
		)
		expect(steps.filter((step) => step.op === 'ConfigureModule').map((step) => step.id)).toEqual(['@antelopejs/dms'])
	})

	it('gives the builder and the assistant one connection, on the DMS', () => {
		const steps = connectSteps(form(), project({ modules: ['dms'] }), POSTGRES_DRIVER)
		expect(steps.filter((step) => step.op === 'ConfigureModule')).toEqual([
			{
				op: 'ConfigureModule',
				id: 'dms',
				entry: {
					importOverrides: [
						{ interface: '@antelopejs/interface-database-catalog', source: 'builder-db-erp', id: 'erp' },
					],
				},
			},
		])
	})

	it('pins each module the builder says needs the project\'s own database, one step each', () => {
		const steps = connectSteps(
			form(),
			project({
				modules: ['dms', 'app', 'mongodb'],
				ownDatabase: 'mongodb',
				databasePins: [
					{ module: 'dms', provider: 'mongodb' },
					{ module: 'app', provider: 'mongodb' },
				],
			}),
			POSTGRES_DRIVER,
		)
		expect(steps.slice(3)).toEqual([
			{
				op: 'ConfigureModule',
				id: 'dms',
				entry: { importOverrides: [{ interface: '@antelopejs/interface-database', source: 'mongodb' }] },
			},
			{
				op: 'ConfigureModule',
				id: 'app',
				entry: { importOverrides: [{ interface: '@antelopejs/interface-database', source: 'mongodb' }] },
			},
		])
	})

	describe('and its registration with dms-database', () => {
		const registered = project({
			modules: ['dms', 'dms-database', 'mongodb'],
			ownDatabase: 'mongodb',
			dmsDatabase: 'dms-database',
		})
		const dmsDatabaseStep = (form: ConnectForm, modules = registered) =>
			connectSteps(form, modules, POSTGRES_DRIVER).find((step) => step.id === 'dms-database')

		it('writes the own database first, then the connection on both interfaces, and reads it only by default', () => {
			expect(dmsDatabaseStep(form())).toEqual({
				op: 'ConfigureModule',
				id: 'dms-database',
				entry: {
					importOverrides: [
						{ interface: '@antelopejs/interface-database', source: 'mongodb' },
						{ interface: '@antelopejs/interface-database', source: 'builder-db-erp', id: 'erp' },
						{ interface: '@antelopejs/interface-database-catalog', source: 'builder-db-erp', id: 'erp' },
					],
					config: { externalConnections: { erp: { access: 'read' } } },
				},
			})
		})

		it('writes read-write access when the integrator chose it', () => {
			expect(dmsDatabaseStep(form({ access: 'read-write' }))).toMatchObject({
				entry: { config: { externalConnections: { erp: { access: 'read-write' } } } },
			})
		})

		it('comes after the catalog connection and before the pins', () => {
			const steps = connectSteps(
				form(),
				{ ...registered, databasePins: [{ module: 'app', provider: 'mongodb' }] },
				POSTGRES_DRIVER,
			)
			expect(steps.map((step) => step.id)).toEqual([
				'builder-db-erp',
				'builder-db-erp-tables',
				'dms',
				'dms-database',
				'app',
			])
		})

		it('is written when the project has dms-database and an own database to pin it to, and not otherwise', () => {
			expect(dmsDatabaseStep(form())).toBeDefined()
			expect(dmsDatabaseStep(form(), project({ modules: registered.modules, ownDatabase: 'mongodb' }))).toBeUndefined()
			expect(dmsDatabaseStep(form(), project({ modules: registered.modules, dmsDatabase: 'dms-database' }))).toBeUndefined()
		})
	})

	it('never carries the connection details into the configuration', () => {
		expect(JSON.stringify(connectSteps(form(), project({ modules: ['dms-assistant'] }), POSTGRES_DRIVER))).not.toMatch(
			/s3cret|db\.example|postgres:\/\//,
		)
	})

	it('waits for a name, a host, a database and a user', () => {
		expect(missingField(form())).toBeUndefined()
		expect(missingField(form({ name: ' - ' }))).toBe('a name')
		expect(missingField(form({ fields: { ...form().fields, user: '' } }))).toBe('a user')
	})
})

describe('the wiring of a document database', () => {
	const mongodb = (overrides: Partial<ConnectForm> = {}) =>
		form({
			engine: 'mongodb',
			fields: { ...FIELDS, port: '27017' },
			...overrides,
		})

	it('wires postgres with its URL only, and disables no export', () => {
		const [driver] = connectSteps(form(), project(), POSTGRES_DRIVER)
		expect(driver.entry).not.toHaveProperty('disabledExports')
		expect(connectVariables(form()).map((variable) => variable.name)).toEqual(['BUILDER_DB_ERP_URL'])
	})

	it('wires mongodb with its URL and database variables, and never offers its raw client', () => {
		const [driver] = connectSteps(mongodb(), project(), { package: '@antelopejs/mongodb', version: '>=1.6.3 <1.7.0' })
		expect(driver.entry).toMatchObject({
			source: { package: '@antelopejs/mongodb', version: '>=1.6.3 <1.7.0' },
			config: { mode: 'external' },
			env: { url: 'BUILDER_DB_ERP_URL', database: 'BUILDER_DB_ERP_DATABASE' },
			disabledExports: ['@antelopejs/interface-mongodb'],
		})
		expect(connectVariables(mongodb())).toEqual([
			{ name: 'BUILDER_DB_ERP_URL', value: 'mongodb://reader:s3cret@db.example:27017/erp' },
			{ name: 'BUILDER_DB_ERP_DATABASE', value: 'erp' },
		])
	})

	it('waits for a database variable only where the driver reads one', () => {
		expect(missingField(mongodb({ overrides: { databaseVariable: ' ' } }))).toBe('a database variable')
		expect(missingField(form({ overrides: { databaseVariable: ' ' } }))).toBeUndefined()
	})

	it('wires rethinkdb with the database in its URL, and never offers its raw client', () => {
		const rethinkdb = form({
			engine: 'rethinkdb',
			fields: { ...FIELDS, port: '28015' },
		})
		const [driver] = connectSteps(rethinkdb, project(), { package: '@antelopejs/rethinkdb', version: '>=1.7.1 <1.9.0' })
		expect(driver.entry).toMatchObject({
			source: { package: '@antelopejs/rethinkdb', version: '>=1.7.1 <1.9.0' },
			env: { url: 'BUILDER_DB_ERP_URL' },
			disabledExports: ['@antelopejs/interface-rethinkdb'],
		})
		expect(connectVariables(rethinkdb)).toEqual([
			{ name: 'BUILDER_DB_ERP_URL', value: 'rethinkdb://reader:s3cret@db.example:28015/erp' },
		])
	})

	it('wires mysql with the database in its URL, and disables no export', () => {
		const { host, database, user, password } = FIELDS
		const mysql = form({ engine: 'mysql', fields: { ...FIELDS, port: '3306' } })
		const [driver] = connectSteps(mysql, project(), { package: '@antelopejs/mysql', version: '>=0.1.0 <0.2.0' })
		expect(driver.entry).toMatchObject({
			source: { package: '@antelopejs/mysql', version: '>=0.1.0 <0.2.0' },
			env: { url: 'BUILDER_DB_ERP_URL' },
		})
		expect(driver.entry).not.toHaveProperty('disabledExports')
		expect(connectVariables(mysql)).toEqual([
			{ name: 'BUILDER_DB_ERP_URL', value: `mysql://${user}:${password}@${host}:3306/${database}` },
		])
	})

	it('reads a URL of each engine, and knows the engine by its scheme', () => {
		expect(parseConnectionUrl('mongodb', 'mongodb://reader:pw@db.example/erp?authSource=admin')).toMatchObject({
			port: '27017',
			database: 'erp',
			options: { authSource: 'admin' },
		})
		expect(() => parseConnectionUrl('mongodb', 'postgres://db.example/erp')).toThrow(/not a MongoDB URL/)
		expect(engineOfScheme('rethinkdb')).toBe('rethinkdb')
		expect(engineOfScheme('postgresql:')).toBe('postgres')
		expect(engineOfScheme('mysql')).toBe('mysql')
		expect(engineOfScheme('mariadb')).toBeUndefined()
	})
})

describe('the tables module of a new connection', () => {
	it('is created under its own folder, its record naming the connection', () => {
		const steps = connectSteps(form(), project(), POSTGRES_DRIVER)
		expect(steps[1]).toEqual({
			op: 'CreateLocalModule',
			id: 'builder-db-erp-tables',
			path: 'modules/builder-db-erp-tables',
			entry: { importOverrides: [{ interface: '@antelopejs/interface-database', source: 'builder-db-erp' }] },
			connection: 'erp',
		})
	})
})

describe('a connection URL', () => {
	it('fills the fields from a pasted URL, decoding its credentials', () => {
		expect(
			parseConnectionUrl('postgres', 'postgresql://re%40der:p%40ss%2Fw@db.example:6432/erp?sslmode=require&application_name=dms'),
		).toEqual({
			host: 'db.example',
			port: '6432',
			database: 'erp',
			user: 're@der',
			password: 'p@ss/w',
			ssl: true,
			options: { application_name: 'dms' },
		})
	})

	it('takes the default port when the URL has none, and SSL off without sslmode', () => {
		expect(parseConnectionUrl('postgres', 'postgres://u@h/db')).toMatchObject({ port: '5432', ssl: false, password: '' })
	})

	it('keeps a strict SSL mode as it was pasted', () => {
		const fields = parseConnectionUrl('postgres', 'postgres://u:p@h/db?sslmode=verify-full')
		expect(fields.ssl).toBe(true)
		expect(connectionUrl('postgres', fields)).toBe('postgres://u:p@h:5432/db?sslmode=verify-full')
	})

	it('refuses a URL of another engine, or no URL at all', () => {
		expect(() => parseConnectionUrl('postgres', 'mysql://u@h/db')).toThrow(/PostgreSQL/)
		expect(() => parseConnectionUrl('postgres', 'db.example')).toThrow()
	})

	it('writes back what it read, credentials encoded and options kept', () => {
		const pasted = 'postgres://re%40der:p%40ss@db.example:6432/erp?application_name=dms&sslmode=require'
		expect(connectionUrl('postgres', parseConnectionUrl('postgres', pasted))).toBe(pasted)
	})

	it('keeps an sslmode the SSL switch does not stand for, until the switch is turned on', () => {
		const fields = parseConnectionUrl('postgres', 'postgres://u:p@h/db?sslmode=no-verify')
		expect(fields.ssl).toBe(false)
		expect(connectionUrl('postgres', fields)).toBe('postgres://u:p@h:5432/db?sslmode=no-verify')
		expect(connectionUrl('postgres', { ...fields, ssl: true })).toBe('postgres://u:p@h:5432/db?sslmode=require')
	})

	it('builds one from the fields, with sslmode when SSL is on', () => {
		expect(connectionUrl('postgres', { ...form().fields, ssl: true })).toBe(
			'postgres://reader:s3cret@db.example:5432/erp?sslmode=require',
		)
	})

	it('writes the database name as the driver decodes it, and refuses one it cannot', () => {
		const fields = { ...form().fields, database: 'sales$2024' }
		expect(connectionUrl('postgres', fields)).toBe('postgres://reader:s3cret@db.example:5432/sales$2024')
		expect(connectionUrl('postgres', { ...fields, database: 'erp main' })).toBe(
			'postgres://reader:s3cret@db.example:5432/erp%20main',
		)
		expect(parseConnectionUrl('postgres', 'postgres://u@h/sales%242024').database).toBe('sales%242024')
		expect(fieldProblem({ ...fields, database: 'a?b' })).toMatch(/\?/)
	})

	it('writes a socket directory as one host, and an IPv6 address in brackets', () => {
		expect(connectionUrl('postgres', { ...form().fields, host: '/var/run/postgresql', port: '' })).toBe(
			'postgres://reader:s3cret@%2Fvar%2Frun%2Fpostgresql/erp',
		)
		expect(connectionUrl('postgres', { ...form().fields, host: '::1' })).toBe('postgres://reader:s3cret@[::1]:5432/erp')
		expect(fieldProblem({ ...form().fields, host: 'db.example ' })).toBeUndefined()
		expect(fieldProblem({ ...form().fields, host: 'db.example:5433' })).toMatch(/port/)
	})
})
