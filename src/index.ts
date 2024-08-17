import { Client, Interaction } from 'discord.js'
import { commands } from './commands'
import { deployCommands } from './deploy'
import { config } from './config'

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
	console.log('Ready!')
	client.user.setActivity(null)
	console.log('Cleared activity')
	console.log('Bot details:', client.user.tag, client.user.id)
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
