const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { ERROR_MESSAGES } = require('../errors');

const FLAG_TO_LANGUAGE = {
    '🇦🇫': { code: 'ps', name: 'Pashto' }, // Afghanistan
    '🇦🇱': { code: 'sq', name: 'Albanian' }, // Albania
    '🇩🇿': { code: 'ar', name: 'Arabic' }, // Algeria
    '🇦🇩': { code: 'ca', name: 'Catalan' }, // Andorra
    '🇦🇴': { code: 'pt', name: 'Portuguese' }, // Angola
    '🇦🇬': { code: 'en', name: 'English' }, // Antigua and Barbuda
    '🇦🇷': { code: 'es', name: 'Spanish' }, // Argentina
    '🇦🇲': { code: 'hy', name: 'Armenian' }, // Armenia
    '🇦🇺': { code: 'en', name: 'English' }, // Australia
    '🇦🇹': { code: 'de', name: 'German' }, // Austria
    '🇦🇿': { code: 'az', name: 'Azerbaijani' }, // Azerbaijan
    '🇧🇸': { code: 'en', name: 'English' }, // Bahamas
    '🇧🇭': { code: 'ar', name: 'Arabic' }, // Bahrain
    '🇧🇩': { code: 'bn', name: 'Bengali' }, // Bangladesh
    '🇧🇧': { code: 'en', name: 'English' }, // Barbados
    '🇧🇾': { code: 'be', name: 'Belarusian' }, // Belarus
    '🇧🇪': { code: 'nl', name: 'Dutch' }, // Belgium
    '🇧🇿': { code: 'en', name: 'English' }, // Belize
    '🇧🇯': { code: 'fr', name: 'French' }, // Benin
    '🇧🇹': { code: 'dz', name: 'Dzongkha' }, // Bhutan
    '🇧🇴': { code: 'es', name: 'Spanish' }, // Bolivia
    '🇧🇦': { code: 'bs', name: 'Bosnian' }, // Bosnia and Herzegovina
    '🇧🇼': { code: 'en', name: 'English' }, // Botswana
    '🇧🇷': { code: 'pt', name: 'Portuguese' }, // Brazil
    '🇧🇳': { code: 'ms', name: 'Malay' }, // Brunei
    '🇧🇬': { code: 'bg', name: 'Bulgarian' }, // Bulgaria
    '🇧🇫': { code: 'fr', name: 'French' }, // Burkina Faso
    '🇧🇮': { code: 'rn', name: 'Kirundi' }, // Burundi
    '🇰🇭': { code: 'km', name: 'Khmer' }, // Cambodia
    '🇨🇲': { code: 'fr', name: 'French' }, // Cameroon
    '🇨🇦': { code: 'en', name: 'English' }, // Canada
    '🇨🇻': { code: 'pt', name: 'Portuguese' }, // Cape Verde
    '🇨🇫': { code: 'fr', name: 'French' }, // Central African Republic
    '🇹🇩': { code: 'fr', name: 'French' }, // Chad
    '🇨🇱': { code: 'es', name: 'Spanish' }, // Chile
    '🇨🇳': { code: 'zh', name: 'Chinese' }, // China
    '🇨🇴': { code: 'es', name: 'Spanish' }, // Colombia
    '🇰🇲': { code: 'ar', name: 'Arabic' }, // Comoros
    '🇨🇬': { code: 'fr', name: 'French' }, // Congo
    '🇨🇷': { code: 'es', name: 'Spanish' }, // Costa Rica
    '🇭🇷': { code: 'hr', name: 'Croatian' }, // Croatia
    '🇨🇺': { code: 'es', name: 'Spanish' }, // Cuba
    '🇨🇾': { code: 'el', name: 'Greek' }, // Cyprus
    '🇨🇿': { code: 'cs', name: 'Czech' }, // Czech Republic
    '🇩🇰': { code: 'da', name: 'Danish' }, // Denmark
    '🇩🇯': { code: 'fr', name: 'French' }, // Djibouti
    '🇩🇲': { code: 'en', name: 'English' }, // Dominica
    '🇩🇴': { code: 'es', name: 'Spanish' }, // Dominican Republic
    '🇪🇨': { code: 'es', name: 'Spanish' }, // Ecuador
    '🇪🇬': { code: 'ar', name: 'Arabic' }, // Egypt
    '🇸🇻': { code: 'es', name: 'Spanish' }, // El Salvador
    '🇬🇶': { code: 'es', name: 'Spanish' }, // Equatorial Guinea
    '🇪🇷': { code: 'ti', name: 'Tigrinya' }, // Eritrea
    '🇪🇪': { code: 'et', name: 'Estonian' }, // Estonia
    '🇪🇹': { code: 'am', name: 'Amharic' }, // Ethiopia
    '🇫🇯': { code: 'en', name: 'English' }, // Fiji
    '🇫🇮': { code: 'fi', name: 'Finnish' }, // Finland
    '🇫🇷': { code: 'fr', name: 'French' }, // France
    '🇬🇦': { code: 'fr', name: 'French' }, // Gabon
    '🇬🇲': { code: 'en', name: 'English' }, // Gambia
    '🇬🇪': { code: 'ka', name: 'Georgian' }, // Georgia
    '🇩🇪': { code: 'de', name: 'German' }, // Germany
    '🇬🇭': { code: 'en', name: 'English' }, // Ghana
    '🇬🇷': { code: 'el', name: 'Greek' }, // Greece
    '🇬🇩': { code: 'en', name: 'English' }, // Grenada
    '🇬🇹': { code: 'es', name: 'Spanish' }, // Guatemala
    '🇬🇳': { code: 'fr', name: 'French' }, // Guinea
    '🇬🇼': { code: 'pt', name: 'Portuguese' }, // Guinea-Bissau
    '🇬🇾': { code: 'en', name: 'English' }, // Guyana
    '🇭🇹': { code: 'fr', name: 'French' }, // Haiti
    '🇭🇳': { code: 'es', name: 'Spanish' }, // Honduras
    '🇭🇰': { code: 'zh', name: 'Chinese' }, // Hong Kong
    '🇭🇺': { code: 'hu', name: 'Hungarian' }, // Hungary
    '🇮🇸': { code: 'is', name: 'Icelandic' }, // Iceland
    '🇮🇳': { code: 'hi', name: 'Hindi' }, // India
    '🇮🇩': { code: 'id', name: 'Indonesian' }, // Indonesia
    '🇮🇷': { code: 'fa', name: 'Persian' }, // Iran
    '🇮🇶': { code: 'ar', name: 'Arabic' }, // Iraq
    '🇮🇪': { code: 'en', name: 'English' }, // Ireland
    '🇮🇱': { code: 'he', name: 'Hebrew' }, // Israel
    '🇮🇹': { code: 'it', name: 'Italian' }, // Italy
    '🇯🇲': { code: 'en', name: 'English' }, // Jamaica
    '🇯🇵': { code: 'ja', name: 'Japanese' }, // Japan
    '🇯🇴': { code: 'ar', name: 'Arabic' }, // Jordan
    '🇰🇿': { code: 'kk', name: 'Kazakh' }, // Kazakhstan
    '🇰🇪': { code: 'sw', name: 'Swahili' }, // Kenya
    '🇰🇮': { code: 'en', name: 'English' }, // Kiribati
    '🇰🇵': { code: 'ko', name: 'Korean' }, // North Korea
    '🇰🇷': { code: 'ko', name: 'Korean' }, // South Korea
    '🇰🇼': { code: 'ar', name: 'Arabic' }, // Kuwait
    '🇰🇬': { code: 'ky', name: 'Kyrgyz' }, // Kyrgyzstan
    '🇱🇦': { code: 'lo', name: 'Lao' }, // Laos
    '🇱🇻': { code: 'lv', name: 'Latvian' }, // Latvia
    '🇱🇧': { code: 'ar', name: 'Arabic' }, // Lebanon
    '🇱🇸': { code: 'en', name: 'English' }, // Lesotho
    '🇱🇷': { code: 'en', name: 'English' }, // Liberia
    '🇱🇾': { code: 'ar', name: 'Arabic' }, // Libya
    '🇱🇮': { code: 'de', name: 'German' }, // Liechtenstein
    '🇱🇹': { code: 'lt', name: 'Lithuanian' }, // Lithuania
    '🇱🇺': { code: 'fr', name: 'French' }, // Luxembourg
    '🇲🇴': { code: 'zh', name: 'Chinese' }, // Macau
    '🇲🇰': { code: 'mk', name: 'Macedonian' }, // Macedonia
    '🇲🇬': { code: 'mg', name: 'Malagasy' }, // Madagascar
    '🇲🇼': { code: 'en', name: 'English' }, // Malawi
    '🇲🇾': { code: 'ms', name: 'Malay' }, // Malaysia
    '🇲🇻': { code: 'dv', name: 'Divehi' }, // Maldives
    '🇲🇱': { code: 'fr', name: 'French' }, // Mali
    '🇲🇹': { code: 'mt', name: 'Maltese' }, // Malta
    '🇲🇭': { code: 'en', name: 'English' }, // Marshall Islands
    '🇲🇷': { code: 'ar', name: 'Arabic' }, // Mauritania
    '🇲🇺': { code: 'fr', name: 'French' }, // Mauritius
    '🇲🇽': { code: 'es', name: 'Spanish' }, // Mexico
    '🇫🇲': { code: 'en', name: 'English' }, // Micronesia
    '🇲🇩': { code: 'ro', name: 'Romanian' }, // Moldova
    '🇲🇨': { code: 'fr', name: 'French' }, // Monaco
    '🇲🇳': { code: 'mn', name: 'Mongolian' }, // Mongolia
    '🇲🇪': { code: 'sr', name: 'Serbian' }, // Montenegro
    '🇲🇦': { code: 'ar', name: 'Arabic' }, // Morocco
    '🇲🇿': { code: 'pt', name: 'Portuguese' }, // Mozambique
    '🇲🇲': { code: 'my', name: 'Burmese' }, // Myanmar
    '🇳🇦': { code: 'en', name: 'English' }, // Namibia
    '🇳🇷': { code: 'en', name: 'English' }, // Nauru
    '🇳🇵': { code: 'ne', name: 'Nepali' }, // Nepal
    '🇳🇱': { code: 'nl', name: 'Dutch' }, // Netherlands
    '🇳🇿': { code: 'en', name: 'English' }, // New Zealand
    '🇳🇮': { code: 'es', name: 'Spanish' }, // Nicaragua
    '🇳🇪': { code: 'fr', name: 'French' }, // Niger
    '🇳🇬': { code: 'en', name: 'English' }, // Nigeria
    '🇳🇴': { code: 'no', name: 'Norwegian' }, // Norway
    '🇴🇲': { code: 'ar', name: 'Arabic' }, // Oman
    '🇵🇰': { code: 'ur', name: 'Urdu' }, // Pakistan
    '🇵🇼': { code: 'en', name: 'English' }, // Palau
    '🇵🇸': { code: 'ar', name: 'Arabic' }, // Palestine
    '🇵🇦': { code: 'es', name: 'Spanish' }, // Panama
    '🇵🇬': { code: 'en', name: 'English' }, // Papua New Guinea
    '🇵🇾': { code: 'es', name: 'Spanish' }, // Paraguay
    '🇵🇪': { code: 'es', name: 'Spanish' }, // Peru
    '🇵🇭': { code: 'tl', name: 'Filipino' }, // Philippines
    '🇵🇱': { code: 'pl', name: 'Polish' }, // Poland
    '🇵🇹': { code: 'pt', name: 'Portuguese' }, // Portugal
    '🇶🇦': { code: 'ar', name: 'Arabic' }, // Qatar
    '🇷🇴': { code: 'ro', name: 'Romanian' }, // Romania
    '🇷🇺': { code: 'ru', name: 'Russian' }, // Russia
    '🇷🇼': { code: 'rw', name: 'Kinyarwanda' }, // Rwanda
    '🇰🇳': { code: 'en', name: 'English' }, // Saint Kitts and Nevis
    '🇱🇨': { code: 'en', name: 'English' }, // Saint Lucia
    '🇻🇨': { code: 'en', name: 'English' }, // Saint Vincent and the Grenadines
    '🇼🇸': { code: 'sm', name: 'Samoan' }, // Samoa
    '🇸🇲': { code: 'it', name: 'Italian' }, // San Marino
    '🇸🇹': { code: 'pt', name: 'Portuguese' }, // Sao Tome and Principe
    '🇸🇦': { code: 'ar', name: 'Arabic' }, // Saudi Arabia
    '🇸🇳': { code: 'fr', name: 'French' }, // Senegal
    '🇷🇸': { code: 'sr', name: 'Serbian' }, // Serbia
    '🇸🇨': { code: 'fr', name: 'French' }, // Seychelles
    '🇸🇱': { code: 'en', name: 'English' }, // Sierra Leone
    '🇸🇬': { code: 'en', name: 'English' }, // Singapore
    '🇸🇰': { code: 'sk', name: 'Slovak' }, // Slovakia
    '🇸🇮': { code: 'sl', name: 'Slovenian' }, // Slovenia
    '🇸🇧': { code: 'en', name: 'English' }, // Solomon Islands
    '🇸🇴': { code: 'so', name: 'Somali' }, // Somalia
    '🇿🇦': { code: 'af', name: 'Afrikaans' }, // South Africa
    '🇸🇸': { code: 'en', name: 'English' }, // South Sudan
    '🇪🇸': { code: 'es', name: 'Spanish' }, // Spain
    '🇱🇰': { code: 'si', name: 'Sinhala' }, // Sri Lanka
    '🇸🇩': { code: 'ar', name: 'Arabic' }, // Sudan
    '🇸🇷': { code: 'nl', name: 'Dutch' }, // Suriname
    '🇸🇿': { code: 'en', name: 'English' }, // Swaziland
    '🇸🇪': { code: 'sv', name: 'Swedish' }, // Sweden
    '🇨🇭': { code: 'de', name: 'German' }, // Switzerland
    '🇸🇾': { code: 'ar', name: 'Arabic' }, // Syria
    '🇹🇼': { code: 'zh', name: 'Chinese' }, // Taiwan
    '🇹🇯': { code: 'tg', name: 'Tajik' }, // Tajikistan
    '🇹🇿': { code: 'sw', name: 'Swahili' }, // Tanzania
    '🇹🇭': { code: 'th', name: 'Thai' }, // Thailand
    '🇹🇱': { code: 'pt', name: 'Portuguese' }, // Timor-Leste
    '🇹🇬': { code: 'fr', name: 'French' }, // Togo
    '🇹🇴': { code: 'en', name: 'English' }, // Tonga
    '🇹🇹': { code: 'en', name: 'English' }, // Trinidad and Tobago
    '🇹🇳': { code: 'ar', name: 'Arabic' }, // Tunisia
    '🇹🇷': { code: 'tr', name: 'Turkish' }, // Turkey
    '🇹🇲': { code: 'tk', name: 'Turkmen' }, // Turkmenistan
    '🇹🇻': { code: 'en', name: 'English' }, // Tuvalu
    '🇺🇬': { code: 'en', name: 'English' }, // Uganda
    '🇺🇦': { code: 'uk', name: 'Ukrainian' }, // Ukraine
    '🇦🇪': { code: 'ar', name: 'Arabic' }, // United Arab Emirates
    '🇬🇧': { code: 'en', name: 'English' }, // United Kingdom
    '🇺🇸': { code: 'en', name: 'English' }, // United States
    '🇺🇾': { code: 'es', name: 'Spanish' }, // Uruguay
    '🇺🇿': { code: 'uz', name: 'Uzbek' }, // Uzbekistan
    '🇻🇺': { code: 'bi', name: 'Bislama' }, // Vanuatu
    '🇻🇦': { code: 'la', name: 'Latin' }, // Vatican City
    '🇻🇪': { code: 'es', name: 'Spanish' }, // Venezuela
    '🇻🇳': { code: 'vi', name: 'Vietnamese' }, // Vietnam
    '🇾🇪': { code: 'ar', name: 'Arabic' }, // Yemen
    '🇿🇲': { code: 'en', name: 'English' }, // Zambia
    '🇿🇼': { code: 'en', name: 'English' }, // Zimbabwe
};

function getLanguageInfo(flagEmoji) {
    if (!flagEmoji || typeof flagEmoji !== 'string') {
        throw new Error(ERROR_MESSAGES.TRANSLATION_INVALID_FLAG);
    }
    return FLAG_TO_LANGUAGE[flagEmoji] || null;
}

function isValidTranslationFlag(emoji) {
    if (!emoji || typeof emoji !== 'string') {
        throw new Error(ERROR_MESSAGES.TRANSLATION_INVALID_FLAG);
    }
    return emoji in FLAG_TO_LANGUAGE;
}

module.exports = {
    FLAG_TO_LANGUAGE,
    getLanguageInfo,
    isValidTranslationFlag
}; 