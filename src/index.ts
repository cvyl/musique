import { Client, Interaction } from 'discord.js'
import { commands } from './commands'
import { deployCommands } from './deploy'
import { config, DEBUG_MODE } from './config'
import { debugLog } from './utils/debug'

const client = new Client({
	intents: [
		'Guilds',
		'GuildMessages',
		'GuildMessageReactions',
		'MessageContent',
		'GuildPresences',
		'GuildVoiceStates'
	]
})

client.once('ready', () => {
	client.user.setActivity(null)
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
				console.error(error)
				await interaction.reply({
					content: 'There was an error while executing this command!',
					ephemeral: true
				})
			}
		}
	} else if (interaction.isAutocomplete()) {
		const { commandName } = interaction
		if (
			commands[commandName as keyof typeof commands] &&
			commands[commandName].autocomplete
		) {
			try {
				await commands[commandName].autocomplete(interaction)
			} catch (error) {
				console.error(error)
				await interaction.respond([])
			}
		}
	}
})

client.on('guildCreate', async (guild) => {
	await deployCommands({ guildId: guild.id })
})

client.login(config.DISCORD_ACCESS_TOKEN)
