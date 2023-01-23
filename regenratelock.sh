#!/bin/sh
# This is a comment!
# echo "Are you sure want to regenrate package-lock.json file (Y/N)"
# read answer
# echo $answer
# if [[ "$answer" -eq "Y" ]]||[[ "$answer" -eq "y" ]]
# then
# echo "hello"
echo 'Regenration of package-lock.json file process started...'
echo 'deltion of node module started ...'
rm -rf node_modules
echo 'Node module removed from project sucessfully.'
echo "removing package-lock.json file process started..."
rm -rf package-lock.json
echo "package-lock.json file deleted sucessfully"
echo "installing node modules"
npm install
#   fi
