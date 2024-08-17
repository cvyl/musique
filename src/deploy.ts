import { REST, Routes } from 'discord.js'
import { config } from './config'
import { commands } from './commands'

const commandsArray = Object.values(commands).map((command) => command.data)

const rest = new REST({ version: '10' }).setToken(config.DISCORD_ACCESS_TOKEN)

type DeployCommandsProps = {
	guildId: string
}

export async function deployCommands({ guildId }: DeployCommandsProps) {
	try {
		console.log('Started refreshing application (/) commands.')

		await rest.put(
			Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
			{ body: commandsArray }
		)

		console.log('Successfully reloaded application (/) commands.')
	} catch (error) {
		console.error(error)
	}
}
