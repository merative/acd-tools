/* ***************************************************************** */
/*                                                                   */
/* (C) Copyright Merative US L.P. and others 2018, 2023              */
/*                                                                   */
/* SPDX-License-Identifier: Apache-2.0                               */
/*                                                                   */
/* ***************************************************************** */

const fs = require('fs');
const got = require('got');
const ospath = require('ospath');
const path = require('path');
const mkdirp = require('mkdirp')
const Q = require('q');

const config = require('./config.json');
dataDir = config.dataDir || path.join(__dirname, './data');
outputDir = config.outputDir || path.join(__dirname,'./output');
const acdUrl = config.url;
const authorization = config.authorization || '';
const extendWordsBy = config.extendWordsBy === 0 ? 0 : config.extendWordsBy || 5;
const annotatorsToExtend = config.extendAnnotations ? config.extendAnnotations : ['SymptomDiseaseInd', 'ProcedureInd', 'MedicationInd'];
const whitespaceRe = /\s/;
const recurse = config.recurse || false;
const printErrors = config.printErrors || false;

let annotatorConfigString = fs.readFileSync(config.annotatorConfig || path.join(__dirname,'./annotatorConfig/default.json'),'utf8');

/**
 * Process a file by reading its content, configuring the annotator, and calling the ACD API for analysis.
 *
 * @param {string} file - The file to be processed.
 * @returns {Promise} A promise that resolves when the file processing is complete.
 */
function processFile (file) {
	let deferred = Q.defer();
	if (file === '.gitignore' || file === '.DS_Store') {
		deferred.resolve();
		return deferred.promise;
	}
	console.log('reading file: '+file);
	fs.readFile(path.join(dataDir,file), 'utf8', (err, content) => {
		if (err) {
			console.log(`Failed to read file ${file}: ` + err);
			deferred.resolve();
		} else {
			let annotatorConfig = JSON.parse(annotatorConfigString);
			if (!annotatorConfig.unstructured || annotatorConfig.unstructured.length === 0) {
				annotatorConfig.unstructured = [{}];
			}
			annotatorConfig.unstructured[0].text = content;
			let options = {
				https: {
					rejectUnauthorized: false
				},
				url: acdUrl,
				method: 'POST',
				json: annotatorConfig,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				  }
			};

			// Only add authentication if config has a string and value
			if (authorization) {
				options.headers['Authorization']=authorization;
			}
			callACD(file, options, deferred, 2);

		}
	});
	return deferred.promise;
}

/**
 * Calls the Clinical Data Annotator (ACD) API to analyze a file.
 *
 * @param {string} file - The file to be analyzed.
 * @param {object} options - The options for the API request.
 * @param {object} deferred - The deferred object for handling promises.
 * @param {number} count - The remaining retry count.
 */
function callACD(file, options, deferred, count) {
	count--;
	got(options)
	  .then(response => {
		if (response.statusCode !== 200) {
		  const code = response.statusCode;
		  if (code < 500 || code >= 600) {
			// don't retry
			count = 0;
		  }
		  let message = `${file} failed with status ${code}: ${response.body || 'No error message provided'}`;
		  if (count > 0) {
			message += '... retrying ...';
		  }
		  console.log(message);
		  if (printErrors) console.log(response);
		  if (count > 0) {
			callACD(file, options, deferred, count);
			return;
		  }
		} else {
		  const text = options.json.unstructured[0].text;
		  const responseBodyJson = JSON.parse(response.body);
		  createOutput(file, text, responseBodyJson);
		}
		deferred.resolve();
	  })
	  .catch(error => {
		console.log(`${file} failed with error:`, error.message);
		deferred.resolve();
	  });
  }

/**
 * Creates the output for a file's analysis results.
 *
 * @param {string} file - The file name or identifier.
 * @param {string} text - The content of the file.
 * @param {object} body - The response body containing the analysis results.
 */
function createOutput(file, text, body) {
	body.filename = file;   // add relative file name to output object
	let unstructured = (body || {}).unstructured || {};
	if (unstructured[0]) {
		let textStr = text || unstructured[0].text || '';
		// remove the text from the response if it is in there
		delete unstructured[0].text;
		if (extendWordsBy && extendWordsBy > 0) {
			// enhance each annotations to include the covered
			// text string +- extendWordsBy words
			let len = textStr.length;
			annotatorsToExtend.forEach(annotator => {
				let annotations = (unstructured[0].data || {})[annotator] || [];
				annotations.forEach(sd => {
					// go back up extendWordsBy words or to start of string
					let wordCount = 0;
					let begin = sd.begin || 0;
					for (let i = begin - 1; i > -1 && wordCount < extendWordsBy;) {
						// find first nonWhitespace
						while ( i > -1 && whitespaceRe.test(textStr[i])) {
							i--;
						}
						// now find beginning of word
						while( i > -1 && !whitespaceRe.test(textStr[i])) {
							i--;
						}
						if (i === -1) {
							// we hit the beginning of the string
							begin = 0;
						} else {
							begin = i + 1;
							wordCount++;
						}
					}
					wordCount = 0;
					let end = sd.end || len - 1;
					for (let i = end + 1; i < len && wordCount < extendWordsBy; i++) {
						// find first nonWhitespace character
						while (i < len && whitespaceRe.test(textStr[i])) {
							i++;
						}
						// now find end of word
						while (i < len && !whitespaceRe.test(textStr[i])) {
							i++;
						}
						if (i === len) {
							// we hit the end of the string
							end = len - 1;
						} else {
							end = i - 1;
							wordCount++;
						}
					}
					sd.extendedText = textStr.substring(begin,end);
				});
			});
		}
	}

	const prettyPrintedJson = JSON.stringify(body, null, 2);
	// let result = JSON.stringify(body || {}, null, 4)

	// Create any output dirs needed including sub dirs based on input dir structure.
	// File here may have subdir names on it.
	outfile = path.join(outputDir,file+'.json');
	outdir = path.dirname(outfile);
	mkdirp.sync(outdir);

	// fs.writeFile(path.join(outputDir,file + '.json'), result, err => {
	// 	if (err) {
	// 		console.log(err);
	// 	} else {
	// 		console.log(file + ' successfully processed!');
	// 	}
	// });

	fs.writeFile(path.join(outputDir, file + '.json'), prettyPrintedJson, err => {
		if (err) {
		  console.log(err);
		} else {
		  console.log(file + ' successfully processed!');
		}
	  });
}

function processFiles(files, i) {
	if (!files || files.length <= i) {
		return;
	}
	processFile(files[i]).then(() => {
		i++;
		processFiles(files, i);
	});
}

/**
 * Recursively process files within a base folder and its subdirectories.
 *
 * @param {string} baseFolder - The base folder to start processing from.
 * @param {string} [subtree] - Optional subtree within the base folder to process.
 * @returns {number} The total number of files processed.
 */
function processFilesRecursive (baseFolder, subtree) {

    var fileContents,
        stats,
        folder,
        files = [];
        total = 0;

    // baseFolder and subTree (if provided) will always end with trailing / char
    if (!baseFolder.endsWith("/")) {
    	baseFolder += '/';
    }
    folder = baseFolder;

    // make folder fully qualified dir name we are processing now
    if (subtree !== undefined) {
    	folder +=  subtree;
    } else {
    	subtree = '';
    }

    fileContents = fs.readdirSync(folder);


	//for all files, add to the list to process, for sub dirs, recurse if requested too
    fileContents.forEach(function (fileName) {
    	stats = fs.lstatSync(folder + '/' + fileName);

		// if its a directory, recurse into subfolders if asked too
   		if (stats.isDirectory()) {
       		if (recurse) {
           		total += processFilesRecursive(baseFolder, subtree + fileName + '/');
        	}
  		} else {
       		// process any files that don't start with a '.' character and don't end with .json
        	if (!fileName.startsWith(".") && !fileName.endsWith(".json")) {
        		if (stats.size == 0 ) {
        			console.log('skipping zero size file: ' + folder + fileName);
        		} else {
        			//console.log('adding: ' + folder + fileName);
        			files.push(subtree+fileName);
        			total++;
        		}
       		}
    	}
	});
	processFiles(files, 0);
	if (subtree === undefined) {
		console.log('processed ' + total + ' files!');
	}
	return total;

};

// common to point to home dir on linux and mac using special ~ char which does not work unless we resolve it here
if (dataDir.includes("~")) {
	dataDir = dataDir.replace("~", ospath.home());
}
if (outputDir.includes("~")) {
	outputDir = outputDir.replace("~", ospath.home());
}

if (extendWordsBy && extendWordsBy > 0) console.log(`Adding extendedText set to coveredText +/- ${extendWordsBy} words for the following annotations: ${annotatorsToExtend}.\n`);
processFilesRecursive(dataDir);

