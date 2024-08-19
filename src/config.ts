import dotenv from 'dotenv'

dotenv.config()

const { DISCORD_ACCESS_TOKEN, DISCORD_CLIENT_ID } = process.env

if (!DISCORD_ACCESS_TOKEN || !DISCORD_CLIENT_ID) {
	throw new Error('Missing environment variables')
}

export const config = {
	DISCORD_ACCESS_TOKEN,
	DISCORD_CLIENT_ID
}

export const DEBUG_MODE: boolean = true
