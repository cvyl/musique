import { ActivityType, Client, Interaction, PresenceUpdateStatus } from 'discord.js'
import { commands } from './commands'
import { deployCommands } from './deploy'
import { config, DEBUG_MODE } from './config'
import { debugLog } from './utils/debug'
import { getVoiceConnection } from '@discordjs/voice'

const client = new Client({
	intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'MessageContent', 'GuildPresences', 'GuildVoiceStates']
})

client.once('ready', () => {
	debugLog('PREPARE', 'Leaving all voice channels')
	getVoiceConnection(client.user.id)?.destroy()
	debugLog('PREPARE', 'Setting bot activity to null')
	client.user.setActivity(null)
	updatePresence()
	if (DEBUG_MODE == false) {
		console.log('Debug mode is disabled')
		console.log('This will mean that a lot of debug messages will not be shown')
		console.log('Bot details:', client.user.tag, client.user.id)
	}
	debugLog('READY', 'Bot is ready')
	debugLog('READY', 'Bot details:', client.user.tag, client.user.id)
	debugLog('READY', 'Bot is in', client.guilds.cache.size, 'guilds')
	debugLog('READY', 'Bot is in', client.channels.cache.size, 'channels')
})

client.on('interactionCreate', async (interaction: Interaction) => {
	if (interaction.isChatInputCommand()) {
		const { commandName } = interaction
		if (commands[commandName as keyof typeof commands]) {
			try {
				await commands[commandName].execute(interaction)
			} catch (error) {
				debugLog('ERROR', 'Error while executing command', commandName, error)
				await interaction.reply({
					content: 'There was an error while executing this command!',
					ephemeral: true
				})
			}
		}
	} else if (interaction.isAutocomplete()) {
		const { commandName } = interaction
		if (commands[commandName as keyof typeof commands] && commands[commandName].autocomplete) {
			try {
				await commands[commandName].autocomplete(interaction)
			} catch (error) {
				debugLog('ERROR', 'Error while executing autocomplete', commandName, error)
				await interaction.respond([])
			}
		}
	}
})

process.on('exit', async () => {
	debugLog('CLEANUP', 'Exit event triggered')
	debugLog('CLEANUP', 'Destroying all voice connections')
	getVoiceConnection(client.user.id)?.destroy()
	debugLog('CLEANUP', 'Logging out of Discord')
	await client.destroy()
	debugLog('CLEANUP', 'Exiting process')
})
process.on('SIGINT', process.exit)

async function updatePresence() {
	debugLog('UPDATE_PRESENCE', 'Setting activity to listening to amount of guilds')
	client.user.setPresence({
		activities: [
			{
				name: `music on ${client.guilds.cache.size} servers`,
				type: ActivityType.Listening
			}
		],
		status: PresenceUpdateStatus.Online
	})
}

client.on('guildCreate', async (guild) => {
	updatePresence()
	debugLog('GUILD_CREATE', 'Joined guild', guild.name, guild.id)
	debugLog('GUILD_CREATE', 'Deploying commands to guild', guild.id)
	await deployCommands({ guildId: guild.id })
})

client.on('guildDelete', async (guild) => {
	updatePresence()
	debugLog('GUILD_DELETE', 'Left guild', guild.name, guild.id)
})

client.login(config.DISCORD_ACCESS_TOKEN)
