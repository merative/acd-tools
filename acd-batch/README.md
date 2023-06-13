# ACD Batch
This project sends every file found in the dataDir to ACD using the annotator configuration specified by the annotatorConfig file.  It saves the result in the outputDir, which can be the dataDir.

## Pre-reqs
Designed for Node.js version 18 or later.  

## Set up
1. Clone this repository
2. Run `npm install` to install required packages

## Configuration
The project is already set up with defaults.  You can modify the defaults by editing the config.json file.  By default, the project will process each text file you place in the data directory by reading it and sending it to ACD.  The ACD configuration is controlled by the annotatorConfig file.  By default, this file is in annotatorConfig/default.json.  After ACD runs, the output is saved in the output directory.

The output of the some annotators are modified to add a property, extendedText, which includes the contents of coveredText +/- 5 words.  To modify the number of words in the span, edit the extendWordsBy property in config.json.  To turn the feature off, set extendWordsBy to 0.
To control which annotators are modified, edit the extendAnnotations array in config.json. To add a new annotator, you will need to look at the output and determine the name of the property that needs to be added.

## Running

After you put your files in the data directory and modify the annotator configuration to meet your needs, enter `npm start`.  Check the output directory for your results.

