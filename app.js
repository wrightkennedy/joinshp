// Global variables for storing parsed data and the shapefile's base name
let globalCSVData = null;
let globalShapefileGeoJSON = null;
let shapefileName = "";

document.addEventListener('DOMContentLoaded', function() {
    // Unified event listener for file uploads
    document.getElementById("shapefile-uploader").addEventListener('change', unifiedFileUploadHandler);
    document.getElementById('csvFile').addEventListener('change', unifiedFileUploadHandler);
    document.getElementById('joinAndDownload').addEventListener('click', performTestRun);
    document.getElementById('convertOnly').addEventListener('click', downloadShapefileOnly);
});

function unifiedFileUploadHandler(event) {
    document.getElementById('loadingBarContainer').style.display = 'block';
    const file = event.target.files[0];
    shapefileName = file.name.split('.').slice(0, -1).join('.').replace(/_/g, ' ');

    if (file.type === "application/zip" || file.name.endsWith('.zip')) {
        // Handle both ZIP files containing shapefiles and CSVs
        processZipFile(file);
    } else if (file.type === "text/csv" || file.name.endsWith('.csv')) {
        // Handle direct CSV file uploads
        processCSVFile(file); // Direct processing for CSV files
    } else {
        console.error('Unsupported file type uploaded.');
        document.getElementById('loadingBarContainer').style.display = 'none';
    }
}

function downloadShapefileOnly() {
    if (!globalShapefileGeoJSON) {
        alert("Please upload a Shapefile (ZIP) first.");
        return;
    }

    const outputFilename = shapefileName ? `${shapefileName}_converted.geojson` : "shapefile.geojson";
    const blob = new Blob([JSON.stringify(globalShapefileGeoJSON)], { type: "application/geo+json" });
    saveAs(blob, outputFilename);
}

async function processZipFile(file, depth = 0) {
    try {
        const zip = await JSZip.loadAsync(file);
        let fileToProcess = null;

        // Check the contents of the ZIP for .shp or .csv files
        Object.keys(zip.files).forEach(fileName => {
            if (fileName.toLowerCase().endsWith('.shp')) {
                fileToProcess = 'shapefile';
            } else if (fileName.toLowerCase().endsWith('.csv') && !fileToProcess) {
                // Prioritize shapefiles; only set to process as CSV if a shapefile hasn't been found
                fileToProcess = 'csv';
            }
        });

        if (fileToProcess === 'shapefile') {
            // Process the ZIP file with the shapefile using shpjs
            processShapefile(file);
        } else if (fileToProcess === 'csv') {
            // If a CSV file is found, extract and process it
            for (const [fileName, zipEntry] of Object.entries(zip.files)) {
                if (fileName.toLowerCase().endsWith('.csv')) {
                    const csvBlob = await zipEntry.async("blob");
                    processCSVFile(csvBlob);
                    return; // Exit after processing the first CSV found
                }
            }
        } else {
            // If no relevant files are found and depth is within limits, look for nested ZIPs
            for (const [fileName, zipEntry] of Object.entries(zip.files)) {
                if (fileName.toLowerCase().endsWith('.zip') && depth < 1) {
                    const nestedZipBlob = await zipEntry.async("blob");
                    await processZipFile(nestedZipBlob, depth + 1);
                    return;
                }
            }

            if (depth === 0) {
                console.log('No shapefile or CSV found in the ZIP.');
            }
        }
    } catch (error) {
        console.error('Error processing ZIP file:', error);
    } finally {
        document.getElementById('loadingBarContainer').style.display = 'none';
    }
}

// The handleCSVUpload, processShapefile, and other utility functions remain unchanged

function handleCSVUpload(event) {
    const file = event.target.files[0];
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            console.log("CSV parsing results:", results);
            globalCSVData = results.data;
            const csvFields = results.meta.fields;
            populateFieldSelections(csvFields, 'csvFieldSelect');
        }
    });
}

function handleShapefileUpload(event) {
    document.getElementById('loadingBarContainer').style.display = 'block';
    document.getElementById('loadingBar').style.width = '100%';

    const file = event.target.files[0];
    shapefileName = file.name.split('.').slice(0, -1).join('.').replace(/_/g, ' ');

    if (file.name.endsWith('.zip')) {
        // Initial call to handle ZIP files, starting with depth 0
        processNestedZip(file, 0);
    } else {
        // Directly process non-ZIP shapefile uploads (for completeness)
        processShapefile(file);
    }
}

function processCSVFile(file) {
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            console.log("CSV parsing results:", results);
            globalCSVData = results.data;
            const csvFields = results.meta.fields;
            populateFieldSelections(csvFields, 'csvFieldSelect');
            document.getElementById('loadingBarContainer').style.display = 'none';
        }
    });
}


function processShapefile(file) {
    fileToArrayBuffer(file).then(buffer => {
        shp(buffer).then(function(geojson) {
            console.log("Converted GeoJSON:", geojson);
            globalShapefileGeoJSON = geojson;
            const shapefileFields = Object.keys(geojson.features[0].properties);
            populateFieldSelections(shapefileFields, 'shapefileFieldSelect');
            document.getElementById('loadingBarContainer').style.display = 'none';
        }).catch(error => {
            console.error('Error processing shapefile:', error);
            document.getElementById('loadingBarContainer').style.display = 'none';
        });
    }).catch(error => {
        console.error('Error converting file to ArrayBuffer:', error);
        document.getElementById('loadingBarContainer').style.display = 'none';
    });
}

function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function populateFieldSelections(fields, selectId) {
    const select = document.getElementById(selectId);
    const options = fields.map(field => {
        const isSelected = field.toLowerCase() === "gisjoin" ? ' selected' : '';
        return `<option value="${field}"${isSelected}>${field}</option>`;
    }).join('');

    select.innerHTML = options;
}

function performTestRun() {
    if (!globalCSVData || !globalShapefileGeoJSON) {
        alert("Both a CSV file and a Shapefile must be uploaded.");
        return;
    }

    const csvField = document.getElementById('csvFieldSelect').value;
    const shapefileField = document.getElementById('shapefileFieldSelect').value;

    if (!csvField || !shapefileField) {
        alert("Please select join fields for both CSV and Shapefile.");
        return;
    }

    // Perform preliminary count of matching records
    const matchingRecords = globalShapefileGeoJSON.features.filter(feature =>
        globalCSVData.some(csvRecord => csvRecord[csvField] == feature.properties[shapefileField])
    );
    if (matchingRecords.length == 0) {
        alert("Zero records are expected to join. Please ensure you selected the correct join fields.");
        return;
    }
    const proceed = confirm(`Shapefile records: ${globalShapefileGeoJSON.features.length}\n` +
                            `CSV records: ${globalCSVData.length}\n` +
                            `Records expected to join: ${matchingRecords.length}\n\n` +
                            "Click 'OK' to Download or 'Cancel' to abort.");

    if (proceed) joinAndDownloadGeoJSON(csvField, shapefileField);
}

function joinShapefilePrimary(shapefileGeoJSON, csvData) {
    const csvFieldSelect = document.getElementById('csvFieldSelect').value;
    const shapefileFieldSelect = document.getElementById('shapefileFieldSelect').value;

    // Iterate through each feature in the Shapefile GeoJSON
    let updatedFeatures = shapefileGeoJSON.features.map(feature => {
        let newProps = {...feature.properties}; // Start with original properties

        // Find a matching CSV record, if any
        const match = csvData.find(csvRecord =>
            String(csvRecord[csvFieldSelect]) === String(feature.properties[shapefileFieldSelect])
        );

        // If there's a match, update the new properties object with CSV data
        if (match) {
            Object.keys(match).forEach(key => {
                newProps[key] = match[key]; // This assumes you want to overwrite with CSV data where available
            });
        }

        // Return a new feature object with updated properties
        return {
            ...feature,
            properties: newProps
        };
    });

    return {
        ...shapefileGeoJSON,
        features: updatedFeatures
    };
}

//one to many right join
function joinCSVPrimary(csvData, shapefileGeoJSON) {
    const csvFieldSelect = document.getElementById('csvFieldSelect').value;
    const shapefileFieldSelect = document.getElementById('shapefileFieldSelect').value;

    let newGeoJSON = {
        type: "FeatureCollection",
        features: []
    };

    csvData.forEach(csvRecord => {
        // Filter to find all matching Shapefile features for the current CSV record
        const matchingFeatures = shapefileGeoJSON.features.filter(feature =>
            String(feature.properties[shapefileFieldSelect]) === String(csvRecord[csvFieldSelect])
        );

        if (matchingFeatures.length > 0) {
            matchingFeatures.forEach(matchingFeature => {
                // Clone the matching feature to avoid mutating the original data
                let newFeature = JSON.parse(JSON.stringify(matchingFeature));

                // Merge CSV data into the Shapefile feature's properties
                for (let key in csvRecord) {
                    // Assign CSV data to the new feature's properties, taking care not to overwrite the geometry
                    newFeature.properties[key] = csvRecord[key];
                }

                // Add the newly created feature to the new GeoJSON structure
                newGeoJSON.features.push(newFeature);
            });
        } else {
            // Optional: Handle CSV records with no matching Shapefile feature differently
            // For example, you might want to create a feature without geometry or log a message
            console.log(`No Shapefile match found for CSV record: ${csvRecord[csvFieldSelect]}`);
        }
    });

    return newGeoJSON;
}

function joinAndDownloadGeoJSON() {
    // No need to pass csvField and shapefileField as arguments here, since they are fetched within the functions that need them.
    if (!globalCSVData || !globalShapefileGeoJSON) {
        alert("Please upload both a CSV file and a Shapefile.");
        return;
    }

    // Determine which dataset is primary based on user selection.
    const primaryTable = document.querySelector('input[name="primaryTable"]:checked').value;

    let outputGeoJSON;
    if (primaryTable === "shapefile") {
        outputGeoJSON = joinShapefilePrimary(globalShapefileGeoJSON, globalCSVData);
    } else {
        outputGeoJSON = joinCSVPrimary(globalCSVData, globalShapefileGeoJSON);
    }

    // Generate the output filename based on the shapefile's base name.
    const outputFilename = shapefileName ? `${shapefileName}_join.geojson` : "joined_data.geojson";

    // Convert the joined GeoJSON object to a string and create a Blob for download.
    const blob = new Blob([JSON.stringify(outputGeoJSON)], {type: "application/geo+json"});
    saveAs(blob, outputFilename);
}
