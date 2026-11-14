// Slash command definitions. After changing anything here, run `npm run register`.
import { CATEGORIES, GAME_CHOICES, RATING_CHOICES } from './constants';
import { OptionType } from './discord';

const GUILD_ONLY = { contexts: [0], integration_types: [0] }; // server installs, server channels only

const playOptions = [
  { type: OptionType.STRING, name: 'category', description: 'Only draw from this category', choices: CATEGORIES },
  { type: OptionType.STRING, name: 'rating', description: 'Clean, mixed, or 18+ (18+ needs an Age-Restricted channel)', choices: RATING_CHOICES },
];

export const GLOBAL_COMMANDS = [
  { name: 'tod', description: 'Random Truth or Dare — who\'s in the Hot Seat?', options: playOptions, ...GUILD_ONLY },
  { name: 'truth', description: 'Get a Truth question', options: playOptions, ...GUILD_ONLY },
  { name: 'dare', description: 'Get a Dare', options: playOptions, ...GUILD_ONLY },
  { name: 'nhie', description: 'Never Have I Ever — everyone votes', options: playOptions, ...GUILD_ONLY },
  { name: 'wyr', description: 'Would You Rather — everyone votes', options: playOptions, ...GUILD_ONLY },
  {
    name: 'submit',
    description: 'Suggest a truth, dare, NHIE, or WYR for the shared deck',
    ...GUILD_ONLY,
    options: [
      { type: OptionType.STRING, name: 'game', description: 'Which game is it for?', required: true, choices: GAME_CHOICES },
      { type: OptionType.STRING, name: 'category', description: 'Best-fit category (default: General)', choices: CATEGORIES },
      { type: OptionType.BOOLEAN, name: 'adult', description: 'Is this 18+ content? (default: no)' },
      { type: OptionType.BOOLEAN, name: 'credit', description: 'Show your name on the card when it\'s played? (default: no)' },
    ],
  },
  {
    name: 'settings',
    description: 'Configure The Hot Seat for this server',
    ...GUILD_ONLY,
    options: [
      { type: OptionType.SUB_COMMAND, name: 'view', description: 'Show current settings' },
      {
        type: OptionType.SUB_COMMAND,
        name: 'adult',
        description: 'Turn 18+ prompts on or off for this server',
        options: [
          { type: OptionType.BOOLEAN, name: 'enabled', description: 'Allow 18+ prompts?', required: true },
          {
            type: OptionType.STRING,
            name: 'mode',
            description: 'What games serve by default in 18+ channels (players can still choose)',
            choices: [
              { name: 'Mixed (clean + 18+)', value: 'mix' },
              { name: '18+ only', value: 'adult' },
            ],
          },
        ],
      },
      { type: OptionType.SUB_COMMAND, name: 'adult-channels', description: 'Choose which channels may show 18+ prompts' },
      {
        type: OptionType.SUB_COMMAND,
        name: 'admin-role',
        description: 'Let a role manage these settings (leave empty to clear)',
        options: [{ type: OptionType.ROLE, name: 'role', description: 'Role that can manage Hot Seat settings' }],
      },
    ],
  },
  { name: 'hotseat', description: 'How to play The Hot Seat', ...GUILD_ONLY },
];

/** Registered only in your support server. */
export const SUPPORT_GUILD_COMMANDS = [
  {
    name: 'hs-admin',
    description: 'Hot Seat team tools',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'trust',
        description: 'Auto-approve this user\'s submissions',
        options: [{ type: OptionType.USER, name: 'user', description: 'User to trust', required: true }],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'untrust',
        description: 'Send this user\'s submissions back through review',
        options: [{ type: OptionType.USER, name: 'user', description: 'User to untrust', required: true }],
      },
      { type: OptionType.SUB_COMMAND, name: 'trusted', description: 'List trusted submitters' },
      { type: OptionType.SUB_COMMAND, name: 'stats', description: 'Deck and usage stats' },
      {
        type: OptionType.SUB_COMMAND,
        name: 'show',
        description: 'Look up a prompt by number',
        options: [{ type: OptionType.INTEGER, name: 'id', description: 'Prompt #', required: true }],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'remove',
        description: 'Pull a prompt from the deck',
        options: [{ type: OptionType.INTEGER, name: 'id', description: 'Prompt #', required: true }],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'restore',
        description: 'Put a removed/rejected prompt back in the deck',
        options: [{ type: OptionType.INTEGER, name: 'id', description: 'Prompt #', required: true }],
      },
    ],
  },
];
