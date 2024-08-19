import {
	CommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder
} from 'discord.js'
import { BOT_NAME } from '../config'

export const data = new SlashCommandBuilder()
	.setName('about')
	.setDescription('Replies with information about the bot!')

export async function execute(interaction: CommandInteraction) {
	await interaction.reply({
		embeds: [
			new EmbedBuilder()
				.setTitle(`About ${BOT_NAME}`)
				.setDescription(
					`${BOT_NAME} is a music bot that can play music in voice channels.`
				)
				.addFields(
					{
						name: 'Developer',
						value: 'Mikka ([Website](https://cvyl.me))',
						inline: true
					},
					{
						name: 'Discord',
						value: 'mwikka',
						inline: true
					},
					{
						name: 'GitHub',
						value: '[cvyl](https://github.com/cvyl)',
						inline: true
					}
				)
				.addFields(
					{
						name: 'Version',
						value: '1.0.0',
						inline: true
					},
					{
						name: 'Library',
						value: 'discord.js',
						inline: true
					},
					{
						name: 'Language',
						value: 'TypeScript',
						inline: true
					}
				)
				.setFooter({
					text: 'Mikka: Thank you for using <3',
					iconURL:
						'https://cdn.discordapp.com/avatars/390527881891151872/e59f0c25d52aa35a11393ef34e2986c9'
				})
				.setColor(0x9b30ff)
		]
	})
}
